import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { authenticatedUser } from './auth.js';

// 有限词组扩展不等于语义检索；仅对明确出现的词组扩展一次。
export const retrievalVersion = 'lexical-expansion-1';
const synonymGroups = [
  ['消费', '购买', '买东西'],
  ['提交', '递交', '上交'],
  ['请假', '休假'],
] as const;
export function terms(query: string) {
  const words = query.toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]+/g) ?? [];
  const result = words.flatMap(word => /^[\u4e00-\u9fff]+$/.test(word) && word.length > 2
    ? Array.from({length:word.length-1},(_,index)=>word.slice(index,index+2)) : [word]);
  return [...new Set(result)].slice(0,40);
}

export type Source = { id:string; document_id:string; title:string; position:number; content:string; score:number };
function splitContent(content:string) {
  const chunks:string[]=[];
  for(let index=0;index<content.length;index+=700) chunks.push(content.slice(index,index+800));
  return chunks;
}
export function expandedTerms(query: string) {
  const original = terms(query);
  const additions = synonymGroups.filter(group => group.some(phrase => query.includes(phrase)))
    .flatMap(group => group.flatMap(phrase => terms(phrase)));
  return { original, expanded: [...new Set(additions)].filter(term => !original.includes(term)).slice(0,40) };
}
export async function retrieve(database: Pick<pg.Pool,'query'>, userId:string, query:string): Promise<Source[]> {
  const { original, expanded } = expandedTerms(query);
  const tokens=[...original,...expanded];
  if(!tokens.length)return [];
  const result=await database.query<Source>(`SELECT c.id,d.id AS document_id,d.title,c.position,c.content,
    (SELECT coalesce(sum(CASE WHEN t.term=ANY($3::text[]) THEN 2 ELSE 1 END),0)::integer FROM unnest($2::text[]) AS t(term) WHERE strpos(lower(c.content),t.term)>0) AS score
    FROM document_chunks c JOIN documents d ON d.id=c.document_id
    WHERE d.user_id=$1 AND EXISTS (SELECT 1 FROM unnest($2::text[]) AS t(term) WHERE strpos(lower(c.content),t.term)>0)
    ORDER BY score DESC,d.created_at DESC,c.position,c.id LIMIT 5`,[userId,tokens,original]);
  return result.rows;
}
export function registerKnowledge(app: FastifyInstance, pool?: pg.Pool) {
  app.get('/api/documents', async (request,reply) => {
    if (!pool) return reply.code(503).send({message:'数据库未配置。'});
    const user = await authenticatedUser(request,pool);
    if (!user) return reply.code(401).send({message:'请先登录。'});
    reply.header('Cache-Control','no-store');
    return {documents:(await pool.query('SELECT d.id,d.title,d.created_at,count(c.id)::integer AS chunks FROM documents d LEFT JOIN document_chunks c ON c.document_id=d.id WHERE d.user_id=$1 GROUP BY d.id ORDER BY d.created_at DESC',[user.id])).rows};
  });
  app.get<{Params:{id:string}}>('/api/documents/:id',{
    schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}}},
  },async(request,reply)=>{
    if(!pool)return reply.code(503).send({message:'数据库未配置。'});
    const user=await authenticatedUser(request,pool);
    if(!user)return reply.code(401).send({message:'请先登录。'});
    const result=await pool.query<{id:string;title:string;content:string;position:number}>(
      'SELECT d.id,d.title,c.position,c.content FROM documents d JOIN document_chunks c ON c.document_id=d.id WHERE d.id=$1 AND d.user_id=$2 ORDER BY c.position',
      [request.params.id,user.id]);
    if(!result.rowCount)return reply.code(404).send({message:'文档不存在或无权查看。'});
    reply.header('Cache-Control','no-store');
    return {document:{id:request.params.id,title:result.rows[0]!.title,content:result.rows.map((row,index)=>index?row.content.slice(100):row.content).join(''),chunks:result.rows.length}};
  });
  app.put<{Params:{id:string};Body:{title:string;content:string}}>('/api/documents/:id',{
    bodyLimit:512000,
    schema:{
      params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}},
      body:{type:'object',required:['title','content'],additionalProperties:false,properties:{title:{type:'string',minLength:1,maxLength:120,pattern:'\\S'},content:{type:'string',minLength:1,maxLength:200000,pattern:'\\S'}}},
    },
    config:{rateLimit:{max:10,timeWindow:'1 minute'}},
  },async(request,reply)=>{
    if(!pool)return reply.code(503).send({message:'数据库未配置。'});
    const user=await authenticatedUser(request,pool);
    if(!user)return reply.code(401).send({message:'请先登录。'});
    const title=request.body.title.trim(),content=request.body.content.replace(/\r\n/g,'\n').trim();
    const chunks=splitContent(content),client=await pool.connect();
    try{
      await client.query('BEGIN');
      const found=await client.query('SELECT id FROM documents WHERE id=$1 AND user_id=$2 FOR UPDATE',[request.params.id,user.id]);
      if(!found.rowCount){await client.query('ROLLBACK');return reply.code(404).send({message:'文档不存在或无权修改。'});}
      await client.query('UPDATE documents SET title=$1 WHERE id=$2',[title,request.params.id]);
      await client.query('DELETE FROM document_chunks WHERE document_id=$1',[request.params.id]);
      for(let index=0;index<chunks.length;index++)await client.query('INSERT INTO document_chunks(id,document_id,position,content) VALUES ($1,$2,$3,$4)',[randomUUID(),request.params.id,index+1,chunks[index]]);
      await client.query('COMMIT');
      return {document:{id:request.params.id,title,chunks:chunks.length}};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
  app.delete<{Params:{id:string}}>('/api/documents/:id',{
    schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}}},
    config:{rateLimit:{max:20,timeWindow:'1 minute'}},
  },async (request,reply) => {
    if (!pool) return reply.code(503).send({message:'数据库未配置。'});
    const user = await authenticatedUser(request,pool);
    if (!user) return reply.code(401).send({message:'请先登录。'});
    const deleted = await pool.query('DELETE FROM documents WHERE id=$1 AND user_id=$2 RETURNING id',[request.params.id,user.id]);
    if (!deleted.rowCount) return reply.code(404).send({message:'文档不存在或无权删除。'});
    return {message:'文档已删除。'};
  });
  app.post<{Body:{title:string;content:string}}>('/api/documents',{
    bodyLimit:512000,
    schema:{body:{type:'object',required:['title','content'],additionalProperties:false,properties:{title:{type:'string',minLength:1,maxLength:120,pattern:'\\S'},content:{type:'string',minLength:1,maxLength:200000,pattern:'\\S'}}}},
    config:{rateLimit:{max:10,timeWindow:'1 minute'}},
  },async (request,reply)=>{
    if (!pool) return reply.code(503).send({message:'数据库未配置。'});
    const user = await authenticatedUser(request,pool);
    if (!user) return reply.code(401).send({message:'请先登录。'});
    const client = await pool.connect(), id=randomUUID();
    const content=request.body.content.replace(/\r\n/g,'\n').trim();
    const chunks=splitContent(content);
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO documents(id,user_id,title) VALUES ($1,$2,$3)',[id,user.id,request.body.title.trim()]);
      for(let index=0;index<chunks.length;index++) await client.query('INSERT INTO document_chunks(id,document_id,position,content) VALUES ($1,$2,$3,$4)',[randomUUID(),id,index+1,chunks[index]]);
      await client.query('COMMIT');
      return reply.code(201).send({document:{id,title:request.body.title.trim(),chunks:chunks.length}});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
  app.post<{Body:{query:string}}>('/api/documents/search',{
    schema:{body:{type:'object',required:['query'],additionalProperties:false,properties:{query:{type:'string',minLength:1,maxLength:300,pattern:'\\S'}}}},
    config:{rateLimit:{max:30,timeWindow:'1 minute'}},
  },async(request,reply)=>{
    if(!pool)return reply.code(503).send({message:'数据库未配置。'});
    const user=await authenticatedUser(request,pool);
    if(!user)return reply.code(401).send({message:'请先登录。'});
    const tokens=terms(request.body.query);
    if(!tokens.length)return {sources:[],message:'没有可检索的词项，请输入具体关键词。'};
    const sources=await retrieve(pool,user.id,request.body.query);
    return {sources,message:sources.length?'已找到匹配片段。':'资料不足，没有找到匹配片段。'};
  });
}

import OpenAI from 'openai';
export type ModelMessage = { role: 'user' | 'assistant'; content: string };
export type ModelEvent = { text?: string; usage?: unknown; completed?: boolean };
export type ModelRunner = (messages: ModelMessage[], signal: AbortSignal, instructions?: string) => AsyncIterable<ModelEvent>;
export function modelConfig() {
  return { baseURL: process.env.LLM_BASE_URL ?? 'https://llmtoken.io/v1', model: process.env.LLM_MODEL ?? 'gpt-6.1-sol', mode: process.env.LLM_API_MODE ?? 'responses', configured: Boolean(process.env.LLM_API_KEY?.trim()) };
}
export function generationConfig() {
  const effort=process.env.LLM_REASONING_EFFORT ?? 'low';
  if(!['low','medium','high'].includes(effort))throw new Error('LLM_REASONING_EFFORT 配置无效');
  const maxOutput=Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 1024);
  if(!Number.isInteger(maxOutput)||maxOutput<256||maxOutput>8192)throw new Error('LLM_MAX_OUTPUT_TOKENS 应在 256～8192 之间');
  return {effort:effort as 'low'|'medium'|'high',maxOutput};
}
export const runModel: ModelRunner = async function* (messages, signal, providedInstructions) {
  const config = modelConfig();
  const generation=generationConfig();
  const client = new OpenAI({ apiKey: process.env.LLM_API_KEY, baseURL: config.baseURL, maxRetries: 0, timeout: 120000 });
  const instructions = providedInstructions ?? '你是团队知识库助手。使用中文回答。当前是普通对话，不要声称查阅了团队资料。';
  if (config.mode === 'responses') {
    const stream = await client.responses.create({ model: config.model, input: messages, instructions, stream: true, store: false, max_output_tokens: generation.maxOutput, reasoning:{effort:generation.effort} }, { signal });
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') yield { text: event.delta };
      if (event.type === 'response.completed') yield { completed: true, usage: event.response.usage };
      if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') throw new Error('回答未完成');
    }
  } else if (config.mode === 'chat') {
    const stream = await client.chat.completions.create({ model: config.model, stream: true, max_completion_tokens: generation.maxOutput, reasoning_effort:generation.effort, stream_options: { include_usage: true }, messages: [{ role: 'system', content: instructions }, ...messages] }, { signal });
    for await (const event of stream) {
      const choice = event.choices[0];
      if (choice?.delta.content) yield { text: choice.delta.content };
      if (choice?.delta.refusal) throw new Error('模型拒绝回答');
      if (choice?.finish_reason === 'stop') yield { completed: true };
      else if (choice?.finish_reason) throw new Error('回答未完成');
      if (event.usage) yield { usage: event.usage };
    }
  } else throw new Error('LLM_API_MODE 配置无效');
};
export function modelError(error: unknown): string {
  const status = error instanceof OpenAI.APIError ? error.status : undefined;
  if (status === 401 || status === 403) return '模型鉴权失败，请检查 API 密钥与权限。';
  if (status === 429) return '模型服务额度或请求限制已达到。';
  if (status === 400 || status === 404) return '模型或接口参数不受支持，请核对模型名与 LLM_API_MODE。';
  return '模型调用失败或连接中断，请检查服务地址与网络。';
}

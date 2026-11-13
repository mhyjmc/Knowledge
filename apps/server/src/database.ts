import pg from 'pg';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

export function createDatabase() {
  if (!process.env.DATABASE_URL) return undefined;
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
  });
}

export const migration = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);
CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '新会话',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_id_idx ON conversations(user_id);
`;

export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(2026100901)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const result = await client.query('SELECT version FROM schema_migrations WHERE version = $1', ['001_auth']);
    if (result.rowCount === 0) {
      await client.query(migration);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', ['001_auth']);
    }
    const messagesVersion = await client.query('SELECT version FROM schema_migrations WHERE version=$1', ['002_messages']);
    if (!messagesVersion.rowCount) {
      await client.query(`CREATE TABLE messages (
        id uuid PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY,
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL DEFAULT '',
        status text NOT NULL CHECK (status IN ('completed','generating','cancelled','failed')),
        model text, duration_ms integer, usage jsonb, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX messages_conversation_idx ON messages(conversation_id,sequence);
      INSERT INTO schema_migrations(version) VALUES ('002_messages');`);
    }
    const documentsVersion = await client.query('SELECT version FROM schema_migrations WHERE version=$1', ['003_documents']);
    if (!documentsVersion.rowCount) {
      await client.query(`CREATE TABLE documents (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX documents_owner_idx ON documents(user_id);
      CREATE TABLE document_chunks (
        id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        position integer NOT NULL, content text NOT NULL
      );
      CREATE INDEX chunks_document_idx ON document_chunks(document_id);
      INSERT INTO schema_migrations(version) VALUES ('003_documents');`);
    }
    const sourcesVersion=await client.query('SELECT version FROM schema_migrations WHERE version=$1',['004_sources']);
    if(!sourcesVersion.rowCount){
      await client.query("ALTER TABLE messages ADD COLUMN sources jsonb NOT NULL DEFAULT '[]', ADD COLUMN mode text NOT NULL DEFAULT 'chat'; INSERT INTO schema_migrations(version) VALUES ('004_sources');");
    }
    const tasksVersion=await client.query('SELECT version FROM schema_migrations WHERE version=$1',['005_tasks']);
    if(!tasksVersion.rowCount){
      await client.query(`CREATE TABLE task_runs (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id uuid NOT NULL, instruction text NOT NULL,
        status text NOT NULL CHECK(status IN ('proposing','pending','executed','rejected','failed')),
        draft jsonb, error text, model text, usage jsonb, duration_ms integer,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id)
      );
      CREATE INDEX task_runs_owner_idx ON task_runs(user_id,created_at);
      CREATE TABLE tasks (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        run_id uuid NOT NULL UNIQUE REFERENCES task_runs(id) ON DELETE CASCADE,
        title text NOT NULL, description text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX tasks_owner_idx ON tasks(user_id,created_at);
      CREATE TABLE task_events (
        sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
        action text NOT NULL CHECK(action IN ('proposing','pending','executed','rejected','failed')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX task_events_run_idx ON task_events(run_id,sequence);
      INSERT INTO schema_migrations(version) VALUES ('005_tasks');`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

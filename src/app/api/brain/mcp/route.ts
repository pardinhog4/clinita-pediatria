import { handleToolsRequest } from '@/server/brain/tools-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ferramentas da clínica para o brain-desk (servidor MCP, Streamable HTTP sem sessão).
export const POST = (req: Request) => handleToolsRequest(req);
export const GET = () => Response.json({ error: 'Use POST.' }, { status: 405 });

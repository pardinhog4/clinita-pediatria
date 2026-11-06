import 'dotenv/config';
async function main() {
  const base = process.env.APP_ORIGIN || 'http://localhost:3005';
  const boot = await fetch(base + '/api/auth/session', {
    method: 'POST',
    headers: { Origin: base },
  });
  if (!boot.ok) throw Error('Sessão local indisponível.');
  const session = await boot.json();
  const headers = {
    Origin: base,
    Cookie: boot.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
    'x-csrf-token': session.csrfToken,
  };
  async function request(path: string, data?: unknown) {
    const r = await fetch(base + '/api/' + path, {
      method: data ? 'POST' : 'GET',
      headers: { ...headers, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    const body = await r.json();
    if (!r.ok) throw Error(body.error || 'Falha no teste.');
    return body;
  }
  const meta = await request('meta');
  const conversation = await request('sandbox', {
    unit_id: meta.units[0].id,
    consent: true,
    include_clinical_context: false,
  });
  const messages = [
    'Olá, bom dia! Gostaria de informações sobre atendimento.',
    'Sou a Ana, mãe do Pedro. Ele tem 6 anos e recebeu um pedido de fonoaudiologia. Vocês conseguem ajudar?',
    'Quero falar com uma pessoa da recepção para conferir os documentos e concluir o agendamento. Pode me encaminhar para a fila da recepção?',
  ];
  for (let index = 0; index < messages.length; index++) {
    const queued = await request('sandbox/' + conversation.id + '/messages', {
      request_id: crypto.randomUUID(),
      content: messages[index],
    });
    const deadline = Date.now() + 120000;
    let completed = false;
    while (Date.now() < deadline) {
      const detail = await request('sandbox/' + conversation.id);
      const run = detail.runs.find((r: any) => r.id === queued.id);
      if (run?.status === 'COMPLETED') {
        if (index < 2 && (detail.ai_mode !== 'AI' || detail.queue_id))
          throw Error('Transferência prematura no turno ' + (index + 1));
        if (
          index === 2 &&
          (detail.ai_mode !== 'HUMAN' ||
            detail.queue_name !== 'Recepção' ||
            run.decision.handoff_reason !== 'USER_REQUEST')
        )
          throw Error('Pedido explícito não chegou à recepção.');
        console.log(
          JSON.stringify({
            turn: index + 1,
            mode: detail.ai_mode,
            queue: detail.queue_name,
            next_action: run.decision.next_action,
            handoff_reason: run.decision.handoff_reason,
          }),
        );
        completed = true;
        break;
      }
      if (run && ['FAILED', 'CANCELLED'].includes(run.status))
        throw Error(run.error_message || 'Execução interrompida.');
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!completed) throw Error('Tempo de espera excedido.');
  }
  console.log(
    'FLUXO REAL VALIDADO: saudação e coleta com IA; recepção somente após solicitação explícita.',
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Falha no teste real.');
  process.exitCode = 1;
});

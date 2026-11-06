'use client';
import { useEffect, useState } from 'react';
import { api, post } from '@/lib/client';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
export function OperationalSettings({ unitId, tab }: { unitId: string; tab: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const add = useNotices((s) => s.add);
  useEffect(() => {
    api('settings')
      .then(setData)
      .catch((e) => setError(e.message));
  }, [unitId]);
  function edit(group: string, index: number, key: string, value: unknown) {
    setData((d: any) => ({
      ...d,
      value: {
        ...d.value,
        [group]: d.value[group].map((r: any, i: number) =>
          i === index ? { ...r, [key]: value } : r,
        ),
      },
    }));
    setDirty(true);
  }
  async function save() {
    setBusy(true);
    try {
      await post('operations', {
        operation: 'SETTINGS_SAVE',
        unit_id: unitId,
        version: data.version,
        value: data.value,
      });
      setData(await api('settings'));
      setDirty(false);
      add('Configurações salvas.');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && <p className="error-banner">{error}</p>}
      {!data ? (
        <p className="loading">Carregando configurações…</p>
      ) : (
        <>
          <div className="note">
            Contatos são preparados em uma fila local. Canais de WhatsApp e portais de operadoras
            não estão conectados; nenhum envio externo é declarado como realizado.
          </div>
          {tab === 'automations' ? (
            <div className="card">
              <div className="toolbar">
                <h3>Automações e fila de contato</h3>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await post('operations', {
                        operation: 'PREPARE_AUTOMATIONS',
                        unit_id: unitId,
                      });
                      add(r.message);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Preparar contatos pendentes agora
                </Button>
              </div>
              {data.value.automations.map((a: any, i: number) => (
                <div className="setting-row" key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {a.minutes_before
                        ? `${a.minutes_before} minutos antes da sessão`
                        : 'Acionamento por evento do atendimento'}
                    </small>
                  </div>
                  <Badge
                    value={a.enabled ? 'APPROVED' : 'EMPTY'}
                    label={a.enabled ? 'Habilitada na configuração' : 'Desligada'}
                  />
                  <label className="sandbox-consent">
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      onChange={(e) => edit('automations', i, 'enabled', e.target.checked)}
                    />
                    Habilitar {a.name}
                  </label>
                  {['token', 'reminder'].includes(a.id) && (
                    <label className="field">
                      Antecedência (min)
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="10080"
                        value={a.minutes_before}
                        onChange={(e) =>
                          edit('automations', i, 'minutes_before', Number(e.target.value))
                        }
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          ) : tab === 'channels' ? (
            <div className="card">
              {data.value.channels.map((c: any, i: number) => (
                <div className="setting-row" key={c.id}>
                  <div className="field">
                    <label htmlFor={'channel-' + c.id}>Nome do canal</label>
                    <input
                      className="input"
                      id={'channel-' + c.id}
                      value={c.name}
                      onChange={(e) => edit('channels', i, 'name', e.target.value)}
                    />
                    <small>{c.description}</small>
                  </div>
                  <Badge value="PENDING" label="Não conectado" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="toolbar">
                <p className="muted small">
                  Modelos do sistema são usados pelos fluxos (lembrete, token, assinatura, lista de
                  espera, espelho de repasse) e podem ter o texto ajustado. Modelos da clínica
                  servem para mensagens manuais.
                </p>
                <Button
                  variant="secondary"
                  className="toolbar-end"
                  onClick={() => {
                    const vars = [
                      ...new Set(
                        data.value.templates
                          .filter((t: any) => t.system)
                          .flatMap((t: any) => t.variables),
                      ),
                    ];
                    setData((d: any) => ({
                      ...d,
                      value: {
                        ...d.value,
                        templates: [
                          ...d.value.templates,
                          {
                            id: 'custom_' + Date.now().toString(36),
                            name: 'Novo modelo',
                            content: 'Olá, {responsavel}! ',
                            variables: vars,
                            system: false,
                          },
                        ],
                      },
                    }));
                    setDirty(true);
                  }}
                >
                  Novo modelo
                </Button>
              </div>
              <div className="agent-grid">
                {data.value.templates.map((t: any, i: number) => (
                  <div className="card form" key={t.id}>
                    <div className="actions between">
                      {t.system ? (
                        <h3>{t.name}</h3>
                      ) : (
                        <input
                          className="input"
                          aria-label="Nome do modelo"
                          value={t.name}
                          onChange={(e) => edit('templates', i, 'name', e.target.value)}
                        />
                      )}
                      <Badge
                        value={t.system ? 'CONFIRMED' : 'neutral'}
                        label={t.system ? 'Modelo do sistema' : 'Modelo da clínica'}
                      />
                    </div>
                    <label className="field">
                      Mensagem do modelo
                      <textarea
                        className="input"
                        rows={5}
                        value={t.content}
                        onChange={(e) => edit('templates', i, 'content', e.target.value)}
                      />
                    </label>
                    <small>
                      Variáveis: {(t.variables || []).map((v: string) => '{' + v + '}').join(', ')}
                    </small>
                    {!t.system && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setData((d: any) => ({
                            ...d,
                            value: {
                              ...d.value,
                              templates: d.value.templates.filter((x: any) => x.id !== t.id),
                            },
                          }));
                          setDirty(true);
                        }}
                      >
                        Remover modelo
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="form-footer">
            <span className="muted small">
              {dirty ? 'Alterações não salvas' : 'Configuração persistida · versão ' + data.version}
            </span>
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? 'Salvando…' : 'Salvar configurações'}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

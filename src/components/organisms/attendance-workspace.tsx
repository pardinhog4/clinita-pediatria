'use client';
import { useEffect, useState } from 'react';
import { TeamQueue } from './team-queue';
import { ConversationProposals } from './conversation-proposals';
import { ConversationBoard } from './conversation-board';
import { SandboxBoard } from './sandbox-board';
import { Button } from '../atoms/button';
import type { Entity } from '@/lib/types';
export function AttendanceWorkspace({
  rows,
  unitId,
  clinical,
  onSaved,
  onCreate,
  createDisabled,
}: {
  rows: Entity[];
  unitId: string;
  clinical: boolean;
  onSaved: () => void;
  onCreate: () => void;
  createDisabled?: boolean;
}) {
  const [tab, setTab] = useState('conversations');
  useEffect(() => {
    const read = () =>
      setTab(
        window.location.hash === '#sandbox'
          ? 'sandbox'
          : window.location.hash === '#filas'
            ? 'queues'
            : window.location.hash === '#propostas'
              ? 'proposals'
              : 'conversations',
      );
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Áreas do atendimento">
        <button
          role="tab"
          aria-selected={tab === 'conversations'}
          className={tab === 'conversations' ? 'active' : ''}
          onClick={() => {
            setTab('conversations');
            history.replaceState(null, '', location.pathname);
          }}
        >
          Conversas
        </button>
        <button
          role="tab"
          aria-selected={tab === 'queues'}
          className={tab === 'queues' ? 'active' : ''}
          onClick={() => {
            setTab('queues');
            history.replaceState(null, '', location.pathname + '#filas');
          }}
        >
          Filas da equipe
        </button>
        <button
          role="tab"
          aria-selected={tab === 'proposals'}
          className={tab === 'proposals' ? 'active' : ''}
          onClick={() => {
            setTab('proposals');
            history.replaceState(null, '', location.pathname + '#propostas');
          }}
        >
          Propostas
        </button>
        <button
          role="tab"
          aria-selected={tab === 'sandbox'}
          className={tab === 'sandbox' ? 'active' : ''}
          onClick={() => {
            setTab('sandbox');
            history.replaceState(null, '', location.pathname + '#sandbox');
          }}
        >
          Sandbox
        </button>
      </div>
      {tab === 'conversations' ? (
        <>
          <div className="toolbar">
            <Button onClick={onCreate} disabled={createDisabled}>
              Nova conversa
            </Button>
          </div>
          <ConversationBoard rows={rows} unitId={unitId} onSaved={onSaved} />
        </>
      ) : tab === 'queues' ? (
        <TeamQueue unitId={unitId} />
      ) : tab === 'proposals' ? (
        <ConversationProposals unitId={unitId} />
      ) : (
        <SandboxBoard unitId={unitId} clinical={clinical} />
      )}
    </>
  );
}

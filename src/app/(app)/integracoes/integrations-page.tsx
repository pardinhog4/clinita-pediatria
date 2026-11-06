'use client';
import {
  Bot,
  FileCheck2,
  KeyRound,
  MessageCircle,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/atoms/badge';
import { PageFrame } from '@/components/organisms/page-frame';
import { EmailBoard } from '@/components/organisms/email-board';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { canManageClinic } from '@/lib/navigation';

// Situação de cada conector externo previsto para a clínica.
const connectors: { title: string; icon: LucideIcon; description: string; available?: boolean }[] =
  [
    {
      title: 'WhatsApp Business',
      icon: MessageCircle,
      description:
        'Por enquanto, as conversas acontecem no Sandbox, com simulação. O número oficial entra quando o provedor for contratado.',
    },
    {
      title: 'Inteligência artificial',
      icon: Bot,
      description:
        'Teste imagens, PDFs, ferramentas e filas no Sandbox. Ative as respostas com a chave do provedor.',
      available: true,
    },
    {
      title: 'Operadoras e tokens',
      icon: KeyRound,
      description: 'Conferência manual disponível. API depende de cada contrato.',
    },
    {
      title: 'Guias e assinaturas',
      icon: FileCheck2,
      description: 'Evidências manuais disponíveis. Assinatura jurídica precisa de homologação.',
    },
    {
      title: 'Faturamento TISS',
      icon: ShieldCheck,
      description: 'Auditoria operacional disponível. XML exige esquema e homologação.',
    },
  ];

export function IntegrationsPage() {
  const { role } = useWorkspaceContext();
  return (
    <PageFrame section="integracoes">
      <div className="note">
        O financeiro é manual e não depende de plataformas de pagamento. O Sandbox de IA está
        disponível em WhatsApp. A conexão com números externos é o próximo passo.
      </div>
      <div className="agent-grid">
        {connectors.map(({ title, icon: Icon, description, available }) => (
          <div className="card agent-card" key={title}>
            <span className="agent-icon">
              <Icon size={24} />
            </span>
            <h2>{title}</h2>
            <p>{description}</p>
            <Badge
              value={available ? 'APPROVED' : 'PENDING'}
              label={available ? 'Sandbox disponível' : 'Conector não configurado'}
            />
          </div>
        ))}
      </div>
      {canManageClinic(role) && <EmailBoard />}
    </PageFrame>
  );
}

import Link from 'next/link';
import { ArrowUpRight, Home, Stethoscope, Users } from 'lucide-react';
import { labels } from '@/lib/schemas';
import type { Entity } from '@/lib/types';
import { Badge } from '../atoms/badge';
// Situação de um item do plano, do ponto de vista da equipe.
export function referralStatus(i: Entity): [string, string] {
  if (i.state === 'SCHEDULED') return ['APPROVED', 'Agendado'];
  if (i.state === 'ACCEPTED')
    return i.proposal_id
      ? ['CONFIRMED', i.proposal_status === 'ACCEPTED' ? 'Família aceitou' : 'Horários propostos']
      : ['PENDING', 'Aceito · falta horário'];
  if (i.state === 'RESOLVED') return ['DONE', 'Concluído'];
  if (i.state === 'SUPERSEDED') return ['neutral', 'Substituído'];
  if (i.route === 'PROFESSIONAL') return ['CONFIRMED', 'Aguarda aceite'];
  return i.match_status === 'NOT_OFFERED'
    ? ['neutral', 'Não oferecido']
    : i.match_status === 'PARTIAL'
      ? ['PENDING', 'Coordenação decide']
      : ['PENDING', 'Sem profissional'];
}
export const specialtyText = (codes: string[]) => codes.map((c) => labels[c] || c).join(' · ');
export function ReferralPlan({ plan }: { plan: Entity }) {
  const items: Entity[] = plan.items,
    routed = items.filter((i) => i.route === 'PROFESSIONAL').length;
  return (
    <section className="referral-plan" aria-label="Plano de encaminhamento">
      <header>
        <div>
          <h3>Plano de encaminhamento</h3>
          <small>
            {items.length} {items.length === 1 ? 'serviço' : 'serviços'} · {routed} com profissional
            · {items.length - routed} com a coordenação
          </small>
        </div>
        <Link href="/encaminhamentos" className="referral-plan-link">
          Abrir
          <ArrowUpRight size={13} />
        </Link>
      </header>
      <ol>
        {items.map((i) => {
          const [tone, label] = referralStatus(i);
          return (
            <li key={i.id}>
              <div className="referral-plan-row">
                <p>{i.service_text}</p>
                <Badge value={tone} label={label} />
              </div>
              <div className="referral-plan-meta">
                {i.professional_name ? (
                  <span>
                    <Stethoscope size={12} />
                    {i.professional_name}
                  </span>
                ) : (
                  <span>
                    <Users size={12} />
                    Coordenação clínica
                  </span>
                )}
                {i.load_text && <span>{i.load_text}</span>}
                {i.modality === 'HOME' && (
                  <span>
                    <Home size={12} />
                    Domicílio
                  </span>
                )}
              </div>
              {i.warnings?.length > 0 && (
                <small className="referral-plan-warn">{i.warnings.join(' · ')}</small>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

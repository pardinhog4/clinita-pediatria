'use client';
import { useClinicRules } from '@/hooks/use-clinic-rules';
import Link from 'next/link';
import {
  Activity,
  CalendarDays,
  Users,
  Wallet,
  KeyRound,
  FileCheck2,
  ShieldCheck,
  AlertCircle,
  Clock,
  ArrowUpRight,
  MessageCircle,
  Repeat2,
  type LucideIcon,
} from 'lucide-react';
import { currency, timeLabel } from '@/lib/types';
import { MetricCard } from '../molecules/metric-card';
type Metric = {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  href: string;
};
export function RoleDashboard({ stats, role }: { stats: any; role: string }) {
  const { arrival_window_minutes } = useClinicRules();
  const a = stats.appointments,
    c = stats.controls;
  let cards: Metric[] = [];
  if (role === 'RECEPTION')
    cards = [
      {
        title: 'Chegando agora',
        value: a.arriving_soon,
        detail: `Próximos ${arrival_window_minutes} minutos`,
        icon: CalendarDays,
        href: '/agenda?view=day',
      },
      {
        title: 'Tokens pendentes',
        value: a.pending_auth,
        detail: 'Autorizações das sessões de hoje',
        icon: KeyRound,
        href: '/guias',
      },
      {
        title: 'Guias sem assinatura',
        value: a.pending_signature,
        detail: 'Conferir com o responsável',
        icon: FileCheck2,
        href: '/guias',
      },
      {
        title: 'Sem chegada nem falta',
        value: a.no_arrival,
        detail: 'Horários de hoje que já passaram',
        icon: AlertCircle,
        href: '/agenda?status=SCHEDULED',
      },
      {
        title: 'Revisão humana',
        value: c.human_queue,
        detail: 'Conversas encaminhadas à equipe',
        icon: MessageCircle,
        href: '/atendimento#filas',
      },
    ];
  else if (role === 'CLINICIAN')
    cards = [
      {
        title: 'Minhas sessões hoje',
        value: a.today,
        detail: 'Agenda do profissional vinculado',
        icon: CalendarDays,
        href: '/agenda?view=day',
      },
      {
        title: 'Evoluções pendentes',
        value: a.in_progress,
        detail: 'Finalize antes do próximo atendimento',
        icon: FileCheck2,
        href: '/agenda?status=IN_PROGRESS',
      },
      {
        title: 'Próximo atendimento',
        value: stats.next ? timeLabel(stats.next.starts_at) : '—',
        detail: stats.next?.patient_name || 'Sem próxima sessão agendada',
        icon: Clock,
        href: '/agenda?view=day',
      },
      {
        title: 'Meu repasse',
        value: currency(stats.payout?.total_amount || 0),
        detail: 'Espelho das minhas sessões elegíveis',
        icon: Wallet,
        href: '/repasses',
      },
    ];
  else if (role === 'AUDIT')
    cards = [
      {
        title: 'Auditoria pendente',
        value: a.pending_audit,
        detail: 'Conferir evidências para faturamento',
        icon: ShieldCheck,
        href: '/auditoria',
      },
      {
        title: 'Faturamento em risco',
        value: currency(stats.risk),
        detail: 'Token ou assinatura pendentes',
        icon: AlertCircle,
        href: '/auditoria',
      },
      {
        title: 'Glosas no retorno',
        value: c.denied,
        detail: 'Retornos registrados das operadoras',
        icon: FileCheck2,
        href: '/auditoria',
      },
      {
        title: 'Contestadas pela família',
        value: c.contested,
        detail: 'Bloqueadas até decisão da auditoria',
        icon: MessageCircle,
        href: '/guias',
      },
    ];
  else if (role === 'FINANCE')
    cards = [
      {
        title: 'Prontos para aprovar',
        value: stats.payout?.confirmed || 0,
        detail: 'Espelhos conferidos pelo profissional',
        icon: FileCheck2,
        href: '/repasses',
      },
      {
        title: 'Total a repassar',
        value: currency(stats.payout?.total_amount || 0),
        detail: 'Sessões elegíveis e ajustes justificados',
        icon: Wallet,
        href: '/repasses',
      },
      {
        title: 'PJ com documentos pendentes',
        value: c.pj_pending,
        detail: 'Aprovação bloqueada até regularizar',
        icon: AlertCircle,
        href: '/repasses',
      },
      {
        title: 'Glosas no retorno',
        value: c.denied,
        detail: 'Demonstrativos para análise',
        icon: ShieldCheck,
        href: '/auditoria',
      },
    ];
  else
    cards = [
      {
        title: 'Ocupação da agenda',
        value: stats.occupancy + '%',
        detail: 'Horários ocupados na semana, sem duplicar grupos ABA',
        icon: CalendarDays,
        href: '/agenda?view=week',
      },
      {
        title: 'Taxa de faltas',
        value: stats.absence_rate + '%',
        detail: a.absent + ' faltas de pacientes',
        icon: Activity,
        href: '/agenda?view=absences',
      },
      {
        title: 'Faturamento em risco',
        value: currency(stats.risk),
        detail: 'Atendimentos sem autorização ou assinatura',
        icon: AlertCircle,
        href: '/guias',
      },
      {
        title: 'Evoluções pendentes',
        value: a.in_progress,
        detail: 'Travam o faturamento e o repasse',
        icon: FileCheck2,
        href: '/auditoria',
      },
    ];
  return (
    <>
      <div className="metrics operational-metrics">
        {cards.map((m) => (
          <Link href={m.href} className="metric-link" key={m.title}>
            <MetricCard {...m} />
          </Link>
        ))}
      </div>
      {['ADMIN', 'MANAGEMENT', 'RECEPTION'].includes(role) && (
        <div className="dashboard-columns">
          <div className="card chart-card">
            <div className="actions between">
              <h2>Atendimentos por dia</h2>
              <div className="agenda-legend">
                <span>
                  <i className="legend-dot completed" />
                  Sessões
                </span>
                <span>
                  <i className="legend-dot absent" />
                  Faltas
                </span>
              </div>
            </div>
            <div className="bar-chart">
              {stats.daily.map((d: any) => (
                <div className="bar-group" key={d.day}>
                  <strong>{d.count}</strong>
                  <div
                    className="bar-stack"
                    style={{
                      height: Math.max(
                        8,
                        (d.count / Math.max(1, ...stats.daily.map((v: any) => v.count))) * 180,
                      ),
                    }}
                  >
                    <div
                      className="bar-regular"
                      style={{ flex: Math.max(0, d.count - d.absent) }}
                    />
                    <div className="bar-absent" style={{ flex: d.absent }} />
                  </div>
                  <small>{d.day}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h2>Alertas de controle</h2>
            <Link className="alert-card amber" href="/guias">
              <KeyRound size={20} />
              <div>
                <strong>{c.credits} créditos de sessão</strong>
                <p>Repor antes de mudanças ou término do plano.</p>
              </div>
              <ArrowUpRight size={17} />
            </Link>
            <Link className="alert-card neutral" href="/guias">
              <ShieldCheck size={20} />
              <div>
                <strong>{c.contested} atendimentos contestados</strong>
                <p>Faturamento e repasse bloqueados para revisão.</p>
              </div>
              <ArrowUpRight size={17} />
            </Link>
            <Link className="alert-card green" href="/atendimento#filas">
              <MessageCircle size={20} />
              <div>
                <strong>{c.human_queue} conversas para a equipe</strong>
                <p>Histórico e resumo dos encaminhamentos.</p>
              </div>
              <ArrowUpRight size={17} />
            </Link>
            {role !== 'RECEPTION' && (
              <Link className="alert-card amber" href="/profissionais">
                <Wallet size={20} />
                <div>
                  <strong>{c.pj_pending} PJ com documentos pendentes</strong>
                  <p>Conferir CNPJ e conta PJ antes da aprovação.</p>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            )}
          </div>
        </div>
      )}
      {stats.financial && (
        <>
          <h2 className="section-title">Financeiro da unidade</h2>
          <div className="metrics three">
            <MetricCard
              title="Saldo registrado"
              value={currency(stats.financial.balance)}
              detail="Entradas e saídas baixadas manualmente"
              icon={Wallet}
            />
            <MetricCard
              title="A receber"
              value={currency(stats.financial.receivable)}
              detail="Lançamentos em aberto"
              icon={ArrowUpRight}
            />
            <MetricCard
              title="A pagar"
              value={currency(stats.financial.payable)}
              detail="Compromissos da unidade"
              icon={Clock}
            />
          </div>
        </>
      )}
    </>
  );
}

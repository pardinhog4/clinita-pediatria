'use client';
import { setViewTimezone } from '@/lib/view-timezone';
import { DEFAULT_TIMEZONE } from '@/lib/timezone';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, CheckCircle2, ChevronDown, LogOut, Menu, RefreshCw, X } from 'lucide-react';
import { api, del, isUnauthorized, loginUrl, fetchAll } from '@/lib/client';
import { setSpecialties } from '@/lib/schemas';
import type { Collection, Lookups, Meta } from '@/lib/types';
import { navigation, roleLabels, sectionAllowed } from '@/lib/navigation';
import { useNotices, useWorkspace } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { ThemeSwitcher } from '../molecules/theme-switcher';
import { WorkspaceProvider } from './workspace-context';

// Moldura da área logada: carrega a sessão, escolhe a unidade, desenha menu e barra superior,
// mantém os cadastros usados nos formulários e só renderiza a página se o perfil tiver acesso.

const emptyLookups: Lookups = { patients: [], professionals: [], insurers: [], rooms: [] };

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const section = pathname.split('/')[1] || 'inicio';
  const { unitId, setUnit, sidebar, setSidebar } = useWorkspace();
  const { items: notifications, remove } = useNotices();

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState('');
  const [metaLoading, setMetaLoading] = useState(true);
  const [navCounts, setNavCounts] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [lookups, setLookups] = useState<Lookups>(emptyLookups);
  const [lookupsReady, setLookupsReady] = useState(false);
  const [revision, setRevision] = useState(0);

  const role = meta?.user.role || '';
  const allowed = !!meta && sectionAllowed(section, role);
  const ready = !!meta && !meta.user.mustChangePassword;

  const signOut = useCallback(async () => {
    try {
      await del('auth/session');
    } catch {
      // A sessão pode já ter expirado; o importante é voltar ao login.
    }
    location.replace('/login');
  }, []);

  const notifyChange = useCallback(() => setRevision((v) => v + 1), []);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const m = await api<Meta>('meta');
      setSpecialties(m.specialties || []);
      setMeta(m);
      if (!m.units.some((u) => u.id === useWorkspace.getState().unitId)) setUnit(m.units[0].id);
      setMetaError('');
    } catch (e) {
      if (isUnauthorized(e)) {
        location.replace(loginUrl());
        return;
      }
      setMetaError((e as Error).message);
    } finally {
      setMetaLoading(false);
    }
  }, [setUnit]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  // Recarga silenciosa (sem tela de carregamento), usada depois de mudar regras e horários.
  const refreshMeta = useCallback(async () => {
    const m = await api<Meta>('meta');
    setSpecialties(m.specialties || []);
    setMeta(m);
  }, []);

  // Quem precisa trocar a senha fica preso ao perfil até concluir a troca.
  useEffect(() => {
    if (meta?.user.mustChangePassword && section !== 'perfil') router.replace('/perfil');
  }, [meta, section, router]);

  // Contadores do menu (pendências por área).
  useEffect(() => {
    if (!ready || !unitId) return;
    api<Record<string, number>>('navigation?unit=' + unitId)
      .then(setNavCounts)
      .catch(() => {});
  }, [ready, unitId, section, revision]);

  // Cadastros usados nos formulários (selects). Perfis sem acesso a algum cadastro recebem lista vazia.
  useEffect(() => {
    if (!ready || !unitId || !meta) return;
    let active = true;
    setLookupsReady(false);
    Promise.all(
      // Pacientes não entram aqui: os formulários buscam pelo nome (/api/directory).
      (['professionals', 'insurers', 'rooms'] as const).map((resource) =>
        fetchAll<Collection['data'][number]>(resource + '?unit=' + unitId).catch((e) => {
          if (meta.user.role === 'ADMIN') throw e;
          return { data: [] as Collection['data'] };
        }),
      ),
    )
      .then(([professionals, insurers, rooms]) => {
        if (!active) return;
        setLookups({
          patients: [],
          professionals: professionals.data,
          insurers: insurers.data,
          rooms: rooms.data,
        });
        setLookupsReady(true);
      })
      .catch((e: Error) => {
        if (active) setMetaError(e.message);
      });
    return () => {
      active = false;
    };
  }, [ready, meta, unitId, revision]);

  const unitName = meta?.units.find((u) => u.id === unitId)?.name || 'Unidade';
  // Telas mostram e recebem horários no fuso da unidade selecionada (Configurações → Horários e regras).
  const unitTz = meta?.units.find((u) => u.id === unitId)?.rules.timezone;
  setViewTimezone(unitTz || DEFAULT_TIMEZONE);

  const context = useMemo(
    () =>
      meta
        ? {
            meta,
            role,
            unitId,
            unitName,
            lookups,
            lookupsReady,
            revision,
            notifyChange,
            refreshMeta,
            signOut,
          }
        : null,
    [
      meta,
      role,
      unitId,
      unitName,
      lookups,
      lookupsReady,
      revision,
      notifyChange,
      refreshMeta,
      signOut,
    ],
  );

  const toggleGroup = (label: string) =>
    setCollapsed((v) => (v.includes(label) ? v.filter((k) => k !== label) : [...v, label]));

  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar menu"
          onClick={() => setSidebar(false)}
        />
      )}

      <aside className={'sidebar ' + (sidebar ? 'open' : '')}>
        <Link className="brand" href="/">
          <span className="brand-mark">i</span>
          <div>
            <b>integrar</b>
            <small>multidisciplinar</small>
          </div>
        </Link>

        <nav aria-label="Navegação principal">
          {navigation
            .filter((group) => group.items.some((item) => sectionAllowed(item.section, role)))
            .map((group) => (
              <div className="nav-group" key={group.label}>
                <button
                  className="nav-label"
                  aria-expanded={!collapsed.includes(group.label)}
                  onClick={() => toggleGroup(group.label)}
                >
                  {group.label}
                  <ChevronDown size={12} />
                </button>
                {!collapsed.includes(group.label) &&
                  group.items
                    .filter((item) => sectionAllowed(item.section, role))
                    .map(({ section: key, label, icon: Icon }) => {
                      const count = Number(navCounts[key === 'auditoria' ? 'faturamento' : key]);
                      return (
                        <Link
                          href={'/' + key}
                          className={section === key ? 'active' : ''}
                          key={key}
                          aria-current={section === key ? 'page' : undefined}
                          onClick={() => setSidebar(false)}
                        >
                          <Icon size={17} />
                          <span>{label}</span>
                          {count > 0 && <span className="nav-count">{count}</span>}
                        </Link>
                      );
                    })}
              </div>
            ))}
        </nav>

        <div className="sidebar-profile">
          <Link
            href="/perfil"
            className={'sidebar-profile-link' + (section === 'perfil' ? ' active' : '')}
            aria-current={section === 'perfil' ? 'page' : undefined}
            onClick={() => setSidebar(false)}
          >
            <div className="avatar">{initials(meta?.user.name || 'Integrar')}</div>
            <div>
              <strong>{meta?.user.name || 'Preparando acesso'}</strong>
              <small>{roleLabels[role] || 'Equipe'}</small>
            </div>
          </Link>
          <Button
            variant="ghost"
            className="sidebar-logout"
            aria-label="Sair"
            title="Sair"
            onClick={() => void signOut()}
          >
            <LogOut size={17} />
          </Button>
        </div>

        <div className="sidebar-theme">
          <span>Aparência</span>
          <ThemeSwitcher />
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div className="actions">
            <Button
              className="mobile-menu"
              variant="ghost"
              aria-label="Abrir menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </Button>
            <Building2 size={17} />
            <label className="sr-only" htmlFor="unit-selector">
              Unidade
            </label>
            <select
              id="unit-selector"
              className="unit-selector"
              value={unitId}
              onChange={(e) => setUnit(e.target.value)}
            >
              {meta?.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="topbar-right">
            <ThemeSwitcher />
          </div>
        </header>

        <main className="content">
          {metaError && (
            <div className="error-banner" role="alert">
              {metaError}
              <Button variant="ghost" onClick={() => void loadMeta()}>
                Tentar novamente
              </Button>
            </div>
          )}

          {metaLoading && !meta && (
            <div className="loading">
              <RefreshCw className="spin" size={18} />
              Carregando dados da unidade…
            </div>
          )}

          {context && unitId && allowed && (
            <WorkspaceProvider value={context}>{children}</WorkspaceProvider>
          )}

          {meta && !allowed && (
            <div className="card empty">
              <h2>Área restrita ao seu perfil</h2>
              <p>Use o menu para acessar as áreas autorizadas.</p>
              <Link href="/inicio" className="button secondary">
                Voltar ao início
              </Link>
            </div>
          )}

          {!meta && !metaLoading && (
            <div className="card empty">
              <h2>Não foi possível carregar seu acesso</h2>
              <p>
                Sua sessão pode ter expirado ou o servidor está indisponível. Tente novamente ou
                entre outra vez.
              </p>
              <div className="actions">
                <Button variant="secondary" onClick={() => window.location.reload()}>
                  Tentar novamente
                </Button>
                <Button variant="ghost" onClick={() => location.replace(loginUrl())}>
                  Entrar novamente
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      <div className="toast-stack" aria-live="polite">
        {notifications.map((n) => (
          <button key={n.id} className={'toast ' + n.tone} onClick={() => remove(n.id)}>
            <CheckCircle2 size={18} />
            {n.message}
            <X size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}

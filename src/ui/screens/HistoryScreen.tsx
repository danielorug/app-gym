import { useMemo, useState } from 'react';
import { useSessionList } from '../../lib/data';
import { formatMonthYear, formatShort } from '../../lib/dates';
import { Topbar } from '../components';
import { IconChevronRight, IconSearch } from '../icons';
import { navigate } from '../router';

export function HistoryScreen() {
  const sessions = useSessionList();
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const words = q
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/\s+/)
      .filter(Boolean);
    const match = (text: string) => {
      const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return words.every((w) => t.includes(w));
    };
    const out: { month: string; items: NonNullable<typeof sessions> }[] = [];
    for (const s of sessions ?? []) {
      if (s.setCount === 0 && s.session.finishedAt) continue;
      if (words.length && !match(`${s.session.title} ${s.exerciseNames.join(' ')}`)) continue;
      const month = formatMonthYear(s.session.date);
      const last = out[out.length - 1];
      if (last?.month === month) last.items.push(s);
      else out.push({ month, items: [s] });
    }
    return out;
  }, [sessions, q]);

  return (
    <>
      <Topbar title="Historial" />
      <div className="page">
        <div className="search" style={{ marginBottom: 4 }}>
          <IconSearch />
          <input className="input" placeholder="Buscar por ejercicio o rutina" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {groups.map((g) => (
          <div key={g.month}>
            <div className="section-title">
              {g.month}
            </div>
            <div className="list">
              {g.items.map(({ session, exerciseNames, setCount }) => (
                <button key={session.id} className="list-item" onClick={() => navigate(`sesion/${session.id}`)}>
                  <div style={{ width: 54, flex: 'none' }}>
                    <div className="tiny faint" style={{ textTransform: 'uppercase', fontWeight: 700 }}>
                      {formatShort(session.date).split(' ')[0]}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>{session.date.slice(8).replace(/^0/, '')}</div>
                  </div>
                  <div className="grow">
                    <div className="title">
                      {session.title}
                      {!session.finishedAt && session.source === 'app' && <span className="badge accent" style={{ marginLeft: 6 }}>En curso</span>}
                    </div>
                    <div className="meta">
                      {setCount} series · {exerciseNames.join(', ') || 'sin ejercicios'}
                    </div>
                  </div>
                  <IconChevronRight className="chevron" />
                </button>
              ))}
            </div>
          </div>
        ))}
        {sessions && groups.length === 0 && <div className="empty">{q ? 'Nada coincide con tu búsqueda.' : 'Aquí aparecerán tus entrenamientos.'}</div>}
      </div>
    </>
  );
}

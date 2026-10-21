import { useEffect } from 'react';
import { closeStaleSessions } from '../lib/data';
import { startAutoSync } from '../sync/sync';
import { ToastHost } from './components';
import { IconCalendar, IconDumbbell, IconList, IconMore } from './icons';
import { RestBar, useRest } from './rest';
import { navigate, useRoute } from './router';
import { ExerciseDetailScreen, ExercisesScreen } from './screens/ExercisesScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { MoreScreen } from './screens/MoreScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { RoutineEditScreen, RoutinesScreen } from './screens/RoutinesScreen';
import { SessionScreen } from './screens/SessionScreen';
import { TodayScreen } from './screens/TodayScreen';

const TABS = [
  { path: '', label: 'Hoy', icon: IconDumbbell, match: ['', 'sesion'] },
  { path: 'historial', label: 'Historial', icon: IconCalendar, match: ['historial'] },
  { path: 'ejercicios', label: 'Ejercicios', icon: IconList, match: ['ejercicios', 'ejercicio'] },
  { path: 'mas', label: 'Más', icon: IconMore, match: ['mas', 'rutinas', 'rutina', 'revisar'] },
];

export function App() {
  const route = useRoute();
  const rest = useRest();
  const [section = '', param] = route;

  useEffect(() => {
    startAutoSync();
    // Pedir almacenamiento persistente para que iOS no borre la base local.
    void navigator.storage?.persist?.();
    // Un entrenamiento de otro día que quedó abierto no debe bloquear el de hoy.
    void closeStaleSessions();
    const onVisible = () => document.visibilityState === 'visible' && void closeStaleSessions();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  let screen;
  switch (section) {
    case '':
      screen = <TodayScreen />;
      break;
    case 'sesion':
      screen = <SessionScreen key={param} id={param} />;
      break;
    case 'historial':
      screen = <HistoryScreen />;
      break;
    case 'ejercicios':
      screen = <ExercisesScreen />;
      break;
    case 'ejercicio':
      screen = <ExerciseDetailScreen key={param} id={param} />;
      break;
    case 'mas':
      screen = <MoreScreen />;
      break;
    case 'rutinas':
      screen = <RoutinesScreen />;
      break;
    case 'rutina':
      screen = <RoutineEditScreen key={param} id={param} />;
      break;
    case 'revisar':
      screen = <ReviewScreen />;
      break;
    default:
      screen = <TodayScreen />;
  }

  return (
    <div className={`app${rest ? ' with-rest' : ''}`}>
      {screen}
      <RestBar />
      <ToastHost />
      <nav className="tabbar" aria-label="Secciones">
        <div className="tabbar-inner">
          {TABS.map((t) => {
            const active = t.match.includes(section);
            const Icon = t.icon;
            return (
              <button key={t.label} className={`tab${active ? ' active' : ''}`} onClick={() => navigate(t.path)} aria-current={active ? 'page' : undefined}>
                <Icon />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

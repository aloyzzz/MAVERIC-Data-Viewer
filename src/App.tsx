import { C } from './lib/colors';
import { useSchema } from './hooks/useApi';
import { MiniHeader } from './components/MiniHeader';
import { HintBar } from './components/HintBar';
import { VariationA } from './layouts/VariationA';

export function App() {
  const { schema, error } = useSchema();

  if (error) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: C.bgApp, color: C.danger,
        fontFamily: C.fontMono, fontSize: 12, gap: 8,
      }}>
        <div style={{ fontSize: 28, opacity: 0.4 }}>⚠</div>
        <div>Failed to connect to API server</div>
        <div style={{ color: C.textMuted, fontSize: 11 }}>{error}</div>
        <div style={{ color: C.textDisabled, fontSize: 10, marginTop: 8 }}>
          Start the server: <span style={{ color: C.active }}>npm run dev</span>
        </div>
      </div>
    );
  }

  if (!schema) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: C.bgApp, color: C.textMuted,
        fontFamily: C.fontMono, fontSize: 12,
      }}>
        loading ground_station.db…
      </div>
    );
  }

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      backgroundColor: C.bgApp,
      fontFamily: C.fontSans,
      color: C.textPrimary,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <MiniHeader />
      <VariationA schema={schema} />
      <HintBar />
    </div>
  );
}

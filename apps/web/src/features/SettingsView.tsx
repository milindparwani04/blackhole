import { GUI_SCALES, setSettings, useSettings } from '../settings';

export function SettingsView() {
  const s = useSettings();
  return (
    <div className="stack-lg">
      <section className="panel">
        <div className="panel-head">
          <h1 className="h-title">SETTINGS</h1>
        </div>
        <p className="muted sm">Display preferences are saved in this browser and never change your library.</p>

        <div className="settings-list">
          <div className="setting">
            <div>
              <h2 className="h-section">GUI SCALE</h2>
              <div className="muted sm">Size of every element on screen. Browser zoom is turned off, so this is the only zoom.</div>
            </div>
            <div className="seg" role="radiogroup" aria-label="GUI scale">
              {GUI_SCALES.map((v) => (
                <button key={v} role="radio" aria-checked={s.guiScale === v} className={s.guiScale === v ? 'on' : ''} onClick={() => setSettings({ guiScale: v })}>
                  {Math.round(v * 100)}%
                </button>
              ))}
            </div>
          </div>

          <div className="setting">
            <div>
              <h2 className="h-section">REVIEWS</h2>
              <div className="muted sm">IMDb and Rotten Tomatoes scores on movies, IMDb episode ratings on TV, and the rating filters. Off hides them everywhere; nothing is deleted.</div>
            </div>
            <button className={`toggle setting-toggle ${s.showReviews ? 'on' : ''}`} role="switch" aria-checked={s.showReviews} onClick={() => setSettings({ showReviews: !s.showReviews })}>
              <span className="box">{s.showReviews ? '✓' : ''}</span>
              {s.showReviews ? 'Showing reviews' : 'Reviews hidden'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

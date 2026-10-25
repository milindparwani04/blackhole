import { setSettings, useSettings } from '../settings';

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
              <h2 className="h-section">REVIEWS</h2>
              <div className="muted sm">
                IMDb and Rotten Tomatoes scores on movies, IMDb episode ratings on TV, and the rating filters. Off hides them everywhere; nothing is deleted.
              </div>
            </div>
            <button
              className={`toggle setting-toggle ${s.showReviews ? 'on' : ''}`}
              role="switch"
              aria-checked={s.showReviews}
              onClick={() => setSettings({ showReviews: !s.showReviews })}
            >
              <span className="box">{s.showReviews ? '✓' : ''}</span>
              {s.showReviews ? 'Showing reviews' : 'Reviews hidden'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

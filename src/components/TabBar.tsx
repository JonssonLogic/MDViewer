import type { Tab } from '../hooks/useTabManager';

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export default function TabBar({ tabs, activeTabId, onSwitchTab, onCloseTab }: Props) {
  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map(tab => {
        const name = tab.filePath.split(/[\\/]/).pop() ?? '';
        const isActive = tab.id === activeTabId;

        return (
          <button
            key={tab.id}
            className={`tab-item${isActive ? ' tab-active' : ''}`}
            onClick={() => onSwitchTab(tab.id)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onCloseTab(tab.id); } }}
            title={tab.filePath}
          >
            <span className="tab-name">{name}</span>
            <span
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              title="Close tab"
            >
              ×
            </span>
          </button>
        );
      })}
    </div>
  );
}

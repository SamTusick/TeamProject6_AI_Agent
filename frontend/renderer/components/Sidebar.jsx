import { AudioLines, Plus, Search } from "lucide-react";
import { MeetingList } from "./MeetingList.jsx";

export function Sidebar({
  meetings,
  selected,
  search,
  onSearch,
  locked,
  editing,
  onSelect,
  onNew,
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <AudioLines size={25} />
        </span>
        <div>
          <strong>Team6</strong>
          <span>MEETING WORKSPACE</span>
        </div>
      </div>
      <button className="primary new-meeting" disabled={locked} onClick={onNew}>
        <Plus size={18} /> New meeting
      </button>
      <label className="search">
        <Search size={16} />
        <input
          aria-label="Search meetings"
          placeholder="Search meetings"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      <div className="section-label">
        YOUR MEETINGS <span>{meetings.length}</span>
      </div>
      <MeetingList
        meetings={meetings}
        selected={selected}
        search={search}
        disabled={locked || editing}
        onSelect={onSelect}
      />
      <div className="sidebar-footer">
        <span className="status-dot" /> Local workspace
      </div>
    </aside>
  );
}

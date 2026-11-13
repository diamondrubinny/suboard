import type { Team } from '@suboard/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import { useDirectory, useTeamMutations, useTeams } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, LoadingState, useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../components/Layout';

/** Managers: create teams and choose who is in each. A team grants no access by itself. */
export function TeamsPage() {
  usePageTitle('צוותים');
  const { user } = useAuth();
  const teams = useTeams();
  const { create } = useTeamMutations();
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast('יש להזין שם לצוות', 'error');
    create.mutate(name.trim(), { onSuccess: (t) => (setName(''), toast(`הצוות "${t.name}" נוצר`)), onError: (err) => toast(errorMessage(err), 'error') });
  };
  return (
    <>
      <div className="page-header">
        <h1>צוותים</h1>
      </div>
      <p className="muted">צוות הוא קבוצת משתמשים בעלת שם. הוא אינו נותן הרשאות בעצמו: משתמשים בו כדי להוסיף את כל אנשיו ללוח בבת אחת (בהגדרות הלוח), וכדי למלא עמודה מסוג "צוות". חשבונות אורח אינם יכולים להיות חברים בצוות.</p>
      {canManage && (
        <form onSubmit={add} className="toolbar card">
          <label htmlFor="new-team" className="sr-only">
            שם צוות חדש
          </label>
          <input id="new-team" className="input" placeholder="שם צוות חדש" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            <Icon name="plus" /> צוות חדש
          </button>
        </form>
      )}
      {teams.isPending && <LoadingState />}
      {teams.isError && <ErrorState message={errorMessage(teams.error)} onRetry={() => teams.refetch()} />}
      {teams.data && teams.data.length === 0 && (
        <div className="card">
          <EmptyState title="אין עדיין צוותים">
            <p>צרו צוות ובחרו מי חבר בו.</p>
          </EmptyState>
        </div>
      )}
      {teams.data?.map((t) => <TeamCard key={t.id} team={t} canManage={canManage} />)}
    </>
  );
}

function TeamCard({ team, canManage }: { team: Team; canManage: boolean }) {
  const directory = useDirectory();
  const { update, remove } = useTeamMutations();
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState(team.name);
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');
  const people = (directory.data ?? []).filter((u) => !u.guest);
  // Shown at once; re-synced with the server's answer (and rolled back if it refuses).
  const [members, setMembers] = useState(team.memberIds);
  const serverKey = team.memberIds.join(',');
  useEffect(() => setMembers(team.memberIds), [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (userId: string, on: boolean) => {
    const next = on ? [...members, userId] : members.filter((x) => x !== userId);
    setMembers(next);
    update.mutate({ id: team.id, memberIds: next }, { onError: (e) => (setMembers(team.memberIds), onErr(e)) });
  };
  const hid = `team-${team.id}`;
  return (
    <section className="card" aria-labelledby={hid}>
      <div className="title-row">
        <h2 id={hid}>
          {team.name} <span className="muted">({team.memberIds.length})</span>
        </h2>
        {canManage && (
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginInlineStart: 'auto' }}
            aria-label={`מחיקה: הצוות ${team.name}`}
            onClick={async () => {
              if (await confirm({ title: 'מחיקת צוות', message: `למחוק את הצוות "${team.name}"? אף אחד לא יוסר מלוחות; עמודות "צוות" פשוט יפסיקו להציג אותו.`, confirmLabel: 'מחיקה', danger: true }))
                remove.mutate(team.id, { onSuccess: () => toast('הצוות נמחק'), onError: onErr });
            }}
          >
            מחיקה
          </button>
        )}
      </div>
      {canManage && (
        <div className="field">
          <label htmlFor={`${hid}-name`}>שם הצוות</label>
          <input
            id={`${hid}-name`}
            className="input"
            style={{ maxInlineSize: '22rem' }}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const n = name.trim();
              if (!n) return setName(team.name);
              if (n !== team.name) update.mutate({ id: team.id, name: n }, { onSuccess: () => toast('השם עודכן'), onError: (e) => (setName(team.name), onErr(e)) });
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
      )}
      {canManage ? (
        <fieldset className="filter-choices">
          <legend>חברי הצוות {team.name}</legend>
          {people.map((u) => (
            <label key={u.id} className="check">
              <input type="checkbox" checked={members.includes(u.id)} onChange={(e) => toggle(u.id, e.target.checked)} /> {u.name}
            </label>
          ))}
        </fieldset>
      ) : (
        <p>{people.filter((u) => team.memberIds.includes(u.id)).map((u) => u.name).join(', ') || <span className="muted">אין חברים</span>}</p>
      )}
    </section>
  );
}

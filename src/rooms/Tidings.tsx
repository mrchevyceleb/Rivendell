import { Eye, MailPlus, RefreshCcw, Search } from 'lucide-react';
import { Button, Chip } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { useEmails } from '../hooks/useRoomData';
import { useProxyViewer } from '../hooks/useProxyViewer';

export function Tidings() {
  const { data: emails = [], refetch, isFetching } = useEmails();
  const accounts = Array.from(new Set(emails.map((email) => email.account)));
  const proxy = useProxyViewer();

  return (
    <div className="split-room">
      <aside className="room-rail r-scroll">
        <p className="r-eyebrow-gold">Tidings</p>
        <h2>Unified inbox</h2>
        <div className="search-box">
          <Search size={15} />
          <input placeholder="Search mail" />
        </div>
        <div className="rail-list">
          {accounts.map((account) => (
            <button key={account}>
              <span>{account.split('@')[0]}</span>
              <code>{emails.filter((email) => email.account === account).length}</code>
            </button>
          ))}
        </div>
        <div className="rail-note">
          Draft-only by default. The server route can create drafts, but send actions stay behind review.
        </div>
      </aside>
      <section className="room-scroll r-scroll">
        <RoomHeader
          eyebrow="The Tidings"
          title={`${emails.length} messages, ${accounts.length} realms`}
          subtitle="Three need you. The rest can be shaped, shelved, or watched."
          actions={
            <>
              <Button tone="ghost" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCcw size={15} />
                Refresh
              </Button>
              <Button tone="elf" onClick={() => window.location.assign('/?prompt=Draft%20replies%20for%20the%20messages%20that%20need%20attention.')}>
                <MailPlus size={15} />
                Draft reply
              </Button>
            </>
          }
        />
        <div className="message-list">
          {emails.map((email) => {
            const canPreview = email.status === 'drafted' && Boolean(email.artifactId || email.draftBody);
            const onPreview = () => {
              if (email.artifactId) {
                proxy.open({ source: 'artifact', id: email.artifactId, title: email.subject });
                return;
              }
              if (!email.draftBody) return;
              const looksHtml = /<\/?\w+[\s>]/.test(email.draftBody);
              proxy.open({
                source: 'inline',
                title: email.subject,
                kind: looksHtml ? 'html' : 'text',
                content: email.draftBody,
              });
            };
            return (
              <article className={email.unread ? 'unread' : ''} key={email.id}>
                <span className="read-dot" />
                <div className="sender">{email.from}</div>
                <div className="subject">
                  <strong>{email.subject}</strong>
                  <small>{email.account}</small>
                </div>
                <Chip tone={email.status === 'needs_reply' ? 'rose' : email.status === 'drafted' ? 'gold' : 'neutral'}>
                  {email.status.replaceAll('_', ' ')}
                </Chip>
                <div className="message-row-tail">
                  {canPreview ? (
                    <Button tone="ghost" onClick={onPreview} title="Preview the draft in the in-app viewer">
                      <Eye size={14} />
                      Preview
                    </Button>
                  ) : null}
                  <code>{email.age}</code>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

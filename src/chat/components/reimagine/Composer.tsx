// Reimagined composer — §3.2 / §3.7. One component, two layouts (desktop hint
// row + chip-in-row; mobile attach button + chip dock-meta above). Implements
// the slash-command popover (↑/↓ wrap, Enter/Tab pick, Esc close), the
// ready → stop send-button state machine, auto-grow to the mobile/desktop cap,
// Enter-sends / Shift+Enter-newlines, the `mellon` spark-burst trigger, and
// image attachment (paste, drag/drop, file picker) threaded through send/steer.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CommandEntry } from '../../data/types';
import { ArrowUp, Plus, StopSquare } from './icons';

export type SendImage = { mediaType: string; base64: string; previewDataUrl?: string };
type PendingImage = { id: string; mediaType: string; base64: string; previewUrl: string };

export type ComposerProps = {
  mobile?: boolean;
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string, images?: SendImage[]) => void;
  onStop?: () => void;
  onSteer?: (text: string, images?: SendImage[]) => void;
  busy: boolean;
  commands?: CommandEntry[];
  commandPrefix?: string;
  modelChip?: React.ReactNode;
  hint?: React.ReactNode;
  attachButton?: React.ReactNode;
  attachMenu?: React.ReactNode;
  /** Accept image attachments (paste / drop / picker). Defaults to true. */
  acceptImages?: boolean;
  /** Parent (mobile) can trigger the file picker by calling this ref. */
  openFileInputRef?: React.MutableRefObject<() => void>;
  onMellon?: (sendRect: DOMRect) => void;
};

async function fileToImage(f: File): Promise<PendingImage | null> {
  if (!f.type.startsWith('image/')) return null;
  const buf = new Uint8Array(await f.arrayBuffer());
  // chunked btoa to avoid call-stack overflow on large files
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return {
    id: `img${Math.random().toString(36).slice(2, 8)}`,
    mediaType: f.type,
    base64: btoa(bin),
    previewUrl: URL.createObjectURL(f),
  };
}

export function Composer(props: ComposerProps) {
  const { mobile = false, acceptImages = true } = props;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cap = mobile ? 128 : 148;
  const [popSel, setPopSel] = useState(0);
  const [popDismissed, setPopDismissed] = useState(false);
  const [images, setImages] = useState<PendingImage[]>([]);

  const matches = useMemo(() => {
    const m = /^\/([a-z]*)$/.exec(props.value);
    if (!m) return [];
    const q = m[1];
    return (props.commands ?? []).filter((c) => c.name.startsWith(q));
  }, [props.value, props.commands]);
  const popOpen = matches.length > 0 && !popDismissed;

  useEffect(() => {
    setPopSel(0);
  }, [props.value]);

  // Let the mobile attach menu open the file picker imperatively.
  useEffect(() => {
    if (props.openFileInputRef) {
      props.openFileInputRef.current = () => fileInputRef.current?.click();
    }
  }, [props.openFileInputRef]);

  // Revoke object URLs on unmount so we never leak preview blobs.
  useEffect(
    () => () => {
      for (const img of images) URL.revokeObjectURL(img.previewUrl);
    },
    [images],
  );

  const ingest = async (files: FileList | File[]) => {
    if (!acceptImages) return;
    const next: PendingImage[] = [];
    for (const f of Array.from(files)) {
      const img = await fileToImage(f);
      if (img) next.push(img);
    }
    if (next.length) setImages((prev) => [...prev, ...next]);
  };
  const removeImage = (id: string) =>
    setImages((prev) => {
      const t = prev.find((i) => i.id === id);
      if (t) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((i) => i.id !== id);
    });

  const grow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  };
  useLayoutEffect(grow, [props.value, cap]);

  const payload = (): SendImage[] | undefined =>
    images.length ? images.map((i) => ({ mediaType: i.mediaType, base64: i.base64, previewDataUrl: i.previewUrl })) : undefined;

  const clearImages = () =>
    setImages((prev) => {
      for (const i of prev) URL.revokeObjectURL(i.previewUrl);
      return [];
    });

  const submit = () => {
    const v = props.value.trim();
    const imgs = payload();
    if (!v && !imgs?.length) {
      if (props.busy) props.onStop?.();
      return;
    }
    if (props.busy && props.onSteer) {
      props.onSteer(v, imgs);
      props.onChange('');
      clearImages();
      return;
    }
    if (v.toLowerCase() === 'mellon' && props.onMellon && sendRef.current) {
      props.onMellon(sendRef.current.getBoundingClientRect());
    }
    props.onSend(v, imgs);
    props.onChange('');
    clearImages();
  };

  const pick = (i: number) => {
    const c = matches[i];
    if (!c) return;
    props.onChange(`/${c.name} `);
    taRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPopSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        pick(Math.min(popSel, matches.length - 1));
        return;
      }
      if (e.key === 'Escape') {
        setPopDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const ready = (props.value.trim().length > 0 || images.length > 0) && !props.busy;

  const sendBtn = (extraClass = '') => (
    <button
      ref={sendRef}
      type="button"
      className={`send${ready ? ' ready' : ''}${props.busy ? ' streaming' : ''} ${extraClass}`}
      aria-label={props.busy ? 'Stop' : 'Send'}
      onClick={() => (props.busy ? props.onStop?.() : submit())}
    >
      <ArrowUp className="ic-send" />
      <StopSquare className="ic-stop" />
    </button>
  );

  return (
    <>
      {mobile && props.modelChip ? <div className="dock-meta">{props.modelChip}</div> : null}
      {popOpen ? (
        <div className="pop show" role="listbox">
          <div className="pop-h">Commands of the house</div>
          {matches.map((c, i) => (
            <button key={c.name} type="button" className={`cmd${i === popSel ? ' sel' : ''}`} onClick={() => pick(i)}>
              <span className="cn">/{c.name}</span>
              <span className="ch">{c.description ?? c.title ?? ''}</span>
            </button>
          ))}
        </div>
      ) : null}
      {props.attachMenu}
      <div className="composer">
        {mobile ? props.attachButton : null}
        {images.length > 0 ? (
          <div className="attach-tray">
            {images.map((img) => (
              <div key={img.id} className="attach-thumb">
                <img src={img.previewUrl} alt="attached" />
                <button type="button" className="attach-x" aria-label="remove" onClick={() => removeImage(img.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          ref={taRef}
          rows={1}
          value={props.value}
          placeholder="Speak, friend…"
          aria-label="Message Elrond"
          onChange={(e) => {
            setPopDismissed(false);
            props.onChange(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            if (!acceptImages) return;
            const files: File[] = [];
            for (const item of Array.from(e.clipboardData.items)) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) files.push(f);
              }
            }
            if (files.length) {
              e.preventDefault();
              void ingest(files);
            }
          }}
          onDragOver={(e) => {
            if (acceptImages && Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            if (!acceptImages) return;
            const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
            if (files.length) {
              e.preventDefault();
              void ingest(files);
            }
          }}
        />
        {!mobile ? (
          <div className="composer-row">
            {props.modelChip}
            {props.hint ?? (
              <span className="hint">
                <b>/</b> commands · <b>shift+enter</b> new line
              </span>
            )}
            {sendBtn()}
          </div>
        ) : (
          sendBtn()
        )}
      </div>
      {acceptImages ? (
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) void ingest(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      ) : null}
    </>
  );
}

// Mobile attach (+) button shell — the menu rows are rendered by the parent so
// the toast / insert actions can stay in the screen that owns the composer.
export function AttachButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="attach" aria-label="Attach" onClick={onClick}>
      <Plus />
    </button>
  );
}

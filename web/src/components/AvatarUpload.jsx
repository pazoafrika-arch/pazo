import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Button, Modal, Banner } from './UI.jsx';
import { api, getAccessToken } from '../lib/api.js';
import { useToast } from '../app/ToastContext.jsx';
import { initials as toInitials } from '../lib/format.js';

/**
 * Profile picture picker.
 *
 * The image is cropped to a square and resized to 256px on a canvas in the
 * browser before it is sent. That keeps uploads small without a server-side
 * image library, and means the user sees exactly what will be stored.
 *
 * Drag and drop, click to browse, and paste all work. The server still
 * re-validates everything it receives.
 */

const OUTPUT_SIZE = 256;
const MAX_INPUT_BYTES = 10 * 1024 * 1024; // before resizing

/**
 * Draw the image centre-cropped to a square and return a JPEG data URL.
 * JPEG rather than PNG because a photo at 256px is several times smaller.
 */
function cropToSquare(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      // White ground so a transparent PNG does not become black once encoded.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image'));
    };
    img.src = url;
  });
}

export function AvatarUpload({ user, size = 96, onChanged, label = 'Profile picture' }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  // Bumped after a change so the browser refetches rather than using its cache.
  const [version, setVersion] = useState(0);
  const [src, setSrc] = useState(null);

  /**
   * The avatar endpoint needs an Authorization header, which a plain <img>
   * cannot send, so the bytes are fetched and shown as an object URL.
   */
  useEffect(() => {
    let revoked = null;
    let cancelled = false;

    if (!user?.has_avatar) {
      setSrc(null);
      return undefined;
    }

    (async () => {
      try {
        const res = await fetch(`${api.base}/media/avatar/${user.id}?v=${version}`, {
          headers: { Authorization: `Bearer ${getAccessToken()}` },
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setSrc(revoked);
      } catch {
        /* fall back to initials */
      }
    })();

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [user?.id, user?.has_avatar, version]);

  const handleFile = useCallback(
    async (file) => {
      setError(null);
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setError('Choose an image file');
        return;
      }
      if (file.size > MAX_INPUT_BYTES) {
        setError('That image is very large. Choose one under 10MB.');
        return;
      }
      try {
        setPreview(await cropToSquare(file));
        setOpen(true);
      } catch (err) {
        setError(err.message);
      }
    },
    [],
  );

  // Paste an image straight from the clipboard while the dialog is open.
  useEffect(() => {
    if (!open) return undefined;
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) handleFile(item.getAsFile());
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, handleFile]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/media/avatar', { image: preview });
      setVersion((v) => v + 1);
      setOpen(false);
      setPreview(null);
      toast.success('Profile picture updated');
      onChanged?.({ has_avatar: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del('/media/avatar');
      setSrc(null);
      setVersion((v) => v + 1);
      setOpen(false);
      setPreview(null);
      toast.success('Profile picture removed');
      onChanged?.({ has_avatar: false });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={`avatar-upload ${dragging ? 'dragging' : ''}`}
        style={{ width: size, height: size }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        aria-label={`${label}. Click to change.`}
        title="Click or drop an image to change"
      >
        {src ? (
          <img src={src} alt="" className="avatar-upload-img" />
        ) : (
          <div
            className="avatar-upload-initials"
            style={{ background: user?.avatar_color || 'var(--teal)', fontSize: size * 0.34 }}
          >
            {toInitials(user?.name)}
          </div>
        )}
        <div className="avatar-upload-overlay">
          <Icon name="edit" size={size > 70 ? 20 : 15} />
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {error && !open && (
        <div className="field-error" style={{ marginTop: 8 }}>
          <Icon name="alert-circle" size={13} />
          <span>{error}</span>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setPreview(null);
          setError(null);
        }}
        title="Your profile picture"
        subtitle="This is how it will appear across Pazo"
        footer={
          <>
            {user?.has_avatar && (
              <Button variant="danger-ghost" onClick={remove} disabled={busy}>
                Remove
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setPreview(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={save} loading={busy} disabled={!preview}>
              Save picture
            </Button>
          </>
        }
      >
        {error && (
          <div style={{ marginBottom: 'var(--s-4)' }}>
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-6)', flexWrap: 'wrap' }}>
          {preview && (
            <>
              <div style={{ textAlign: 'center' }}>
                <img src={preview} alt="" className="avatar-preview-lg" />
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Large
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <img src={preview} alt="" className="avatar-preview-sm" />
                <div className="field-hint" style={{ marginTop: 8 }}>
                  In lists
                </div>
              </div>
            </>
          )}

          <div style={{ flex: 1, minWidth: 180 }}>
            <Button variant="secondary" icon="upload" onClick={() => inputRef.current?.click()}>
              Choose another
            </Button>
            <div className="field-hint" style={{ marginTop: 10, lineHeight: 1.6 }}>
              Square images look best. Anything else is cropped from the centre. You can also drag
              a file onto your picture, or paste one.
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default AvatarUpload;

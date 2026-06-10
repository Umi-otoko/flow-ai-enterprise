import type { GeneratedImage } from '../../../utils/types';

interface Props {
  images: GeneratedImage[];
}

export function MiniGallery({ images }: Props) {
  if (images.length === 0) return null;

  const recent = [...images].reverse().slice(0, 12);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
        Gallery &middot; {images.length} image{images.length !== 1 ? 's' : ''}
      </h3>
      <div className="grid grid-cols-4 gap-1.5">
        {recent.map((img) => (
          <div
            key={img.id}
            className="group relative aspect-square rounded overflow-hidden bg-slate-700 border border-slate-600"
            title={img.filename}
          >
            <img
              src={img.url}
              alt={`Scene ${img.sceneNumber} img ${img.imageIndex}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-[9px] font-mono text-center px-1 leading-tight">
                S{img.sceneNumber}-{img.imageIndex}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

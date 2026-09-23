// QR rendering + printable batch label.
//
// qrcode-generator builds the module matrix; we draw it as inline SVG rather
// than its canvas/img helpers so the label prints crisp at any size and needs
// no runtime canvas.

import qrcode from "qrcode-generator";
import { useMemo } from "react";

export function QrSvg({ value, size = 160, className }: { value: string; size?: number; className?: string }) {
  const { path, count } = useMemo(() => {
    // typeNumber 0 = auto-fit the smallest version; 'M' = ~15% error correction,
    // enough to survive a scuffed warehouse label.
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d += `M${col},${row}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);

  return (
    <svg
      viewBox={`-2 -2 ${count + 4} ${count + 4}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={`QR code for ${value}`}
      shapeRendering="crispEdges"
    >
      <rect x={-2} y={-2} width={count + 4} height={count + 4} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

/** The label artwork itself — same markup on screen and on paper. */
export function BatchLabel({
  batchCode,
  cropType,
  createdDate,
  traceUrl,
  qrSize = 180,
}: {
  batchCode: string;
  cropType: string;
  createdDate: string;
  traceUrl: string;
  qrSize?: number;
}) {
  return (
    <div className="border rounded-md p-4 bg-white text-black flex flex-col items-center gap-2 w-[280px]">
      <QrSvg value={traceUrl} size={qrSize} />
      <p className="text-lg font-bold tracking-wide">{batchCode}</p>
      <p className="text-xs capitalize">
        {cropType} · {createdDate}
      </p>
      <p className="text-[10px] text-center leading-tight">
        BRM Agro · scan to trace this rice
        <br />
        ស្កេនដើម្បីតាមដានស្រូវនេះ
      </p>
    </div>
  );
}

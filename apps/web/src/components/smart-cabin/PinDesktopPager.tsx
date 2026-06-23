import type { ReactNode } from "react";

type Props = {
  pageIndex: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  children: ReactNode;
};

export function PinDesktopPager({ pageIndex, pageCount, onPageChange, children }: Props) {
  return (
    <div className="pin-desktop-pager">
      <div key={pageIndex} className="pin-desktop-pager-slide">
        {children}
      </div>

      {pageCount > 1 ? (
        <div className="pin-desktop-page-dots" role="tablist" aria-label="桌面分页">
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === pageIndex}
              aria-label={`第 ${i + 1} 页`}
              className={`pin-desktop-page-dot${i === pageIndex ? " active" : ""}`}
              onClick={() => onPageChange(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

import { useRef } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

import type { DiffDisplayRow } from "@openx/shared";

import { highlightToHtml } from "../../lib/code-highlight";



/**

 * 来源：vendors/reasonix/desktop/frontend/src/components/editors/HljsDiff.tsx

 * OpenX 适配：rows 由 shared/diffRowsFromUnifiedDiff 预先解析后传入。

 */

const SIGN: Record<"ctx" | "add" | "del", string> = { ctx: " ", add: "+", del: "-" };



function lineNo(n?: number): string {

  return typeof n === "number" ? String(n) : "";

}



export type ReasonixHljsDiffProps = {

  rows: DiffDisplayRow[];

  language?: string;

  maxHeight?: number;

};



export default function ReasonixHljsDiff({ rows, language, maxHeight = 260 }: ReasonixHljsDiffProps) {

  const scrollRef = useRef<HTMLDivElement>(null);

  const isVirtual = rows.length > 200;



  const virtualizer = useVirtualizer({

    count: isVirtual ? rows.length : 0,

    getScrollElement: () => scrollRef.current,

    estimateSize: () => 24,

    overscan: 10,

  });



  const renderRow = (row: DiffDisplayRow, idx: number) => {

    if (row.type === "ellipsis") {

      return (

        <div key={idx} className="tool-diff-line tool-diff-ellipsis" aria-hidden>

          <span className="tool-diff-gutter tool-diff-gutter-ellipsis">…</span>

          <span className="tool-diff-ellipsis-text">未变更行已折叠</span>

        </div>

      );

    }



    return (

      <div key={idx} className={`tool-diff-line tool-diff-${row.type}`}>

        <span className="tool-diff-gutter" aria-hidden>

          <span className="tool-diff-ln tool-diff-ln-old">{lineNo(row.oldLine)}</span>

          <span className="tool-diff-ln tool-diff-ln-new">{lineNo(row.newLine)}</span>

          <span className="tool-diff-sign">{SIGN[row.type]}</span>

        </span>

        <code

          className="tool-diff-code hljs"

          dangerouslySetInnerHTML={{ __html: highlightToHtml(row.text, language) }}

        />

      </div>

    );

  };



  if (rows.length === 0) {

    return <p className="tool-diff-empty">无可见变更</p>;

  }



  return (

    <div

      ref={scrollRef}

      className="tool-diff-body hljs"

      style={{

        maxHeight,

        overflow: maxHeight || isVirtual ? "auto" : undefined,

        position: maxHeight || isVirtual ? "relative" : undefined,

      }}

    >

      {isVirtual ? (

        <div

          className="tool-diff-virtual-inner"

          style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}

        >

          {virtualizer.getVirtualItems().map((item) => {

            const row = rows[item.index];

            if (!row) return null;

            return (

              <div

                key={item.key}

                data-index={item.index}

                ref={virtualizer.measureElement}

                style={{

                  position: "absolute",

                  top: 0,

                  left: 0,

                  width: "100%",

                  transform: `translateY(${item.start}px)`,

                }}

              >

                {renderRow(row, item.index)}

              </div>

            );

          })}

        </div>

      ) : (

        rows.map((row, idx) => renderRow(row, idx))

      )}

    </div>

  );

}



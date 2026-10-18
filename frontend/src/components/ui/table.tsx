import * as React from "react";

import { cn } from "../../lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn(className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />,
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn("border-t border-border bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-12 px-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:w-px [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0.5",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("p-3 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0.5", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };

/**
 * Bordered scroll box that shows the header plus the first `rows` body rows and scrolls the rest.
 * Rows vary in height (wrapping chips), so it measures them; a ResizeObserver on the table
 * re-measures when rows, filters or the viewport width change. Pair with a sticky TableHeader.
 */
function TableScrollBox({ rows = 5, className, children }: { rows?: number; className?: string; children: React.ReactNode }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = React.useState<number>();
  React.useLayoutEffect(() => {
    const el = box.current;
    const table = el?.querySelector("table");
    if (!el || !table) return;
    const measure = () => {
      const head = el.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const trs = [...el.querySelectorAll("tbody tr")].slice(0, rows);
      setMaxH(head + trs.reduce((s, tr) => s + tr.getBoundingClientRect().height, 0) + 2);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    return () => ro.disconnect();
  }, [rows]);
  return (
    <div ref={box} style={{ maxHeight: maxH }}
      className={cn("overflow-auto rounded-lg border border-border bg-white [&>div]:overflow-visible", className)}>
      {children}
    </div>
  );
}

/** Header classes that keep column titles visible inside a TableScrollBox. */
const stickyHeader = "sticky top-0 z-10 bg-white shadow-[0_1px_0_var(--color-border)]";

export { TableScrollBox, stickyHeader };

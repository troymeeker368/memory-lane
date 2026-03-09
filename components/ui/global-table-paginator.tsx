"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const PAGE_SIZE = 25;

function showRowsForPage(rows: HTMLTableRowElement[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  rows.forEach((row, index) => {
    row.style.display = index >= start && index < end ? "" : "none";
  });
}

function stylePagerContainer(container: HTMLDivElement) {
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.justifyContent = "space-between";
  container.style.gap = "0.5rem";
  container.style.marginTop = "0.5rem";
  container.style.fontSize = "0.75rem";
  container.style.color = "#64748b";
}

function stylePagerButton(button: HTMLButtonElement, enabled: boolean) {
  button.type = "button";
  button.style.border = "1px solid #d9d8d6";
  button.style.background = enabled ? "#ffffff" : "#f3f4f6";
  button.style.color = enabled ? "#1b3e93" : "#94a3b8";
  button.style.borderRadius = "0.5rem";
  button.style.padding = "0.25rem 0.5rem";
  button.style.fontWeight = "600";
  button.style.cursor = enabled ? "pointer" : "not-allowed";
}

function applyTablePagination() {
  document.querySelectorAll("table[data-global-paginated='true']").forEach((tableNode) => {
    tableNode.removeAttribute("data-global-paginated");
    const table = tableNode as HTMLTableElement;
    Array.from(table.rows).forEach((row) => {
      row.style.display = "";
    });
  });

  document.querySelectorAll("div[data-global-table-pager='true']").forEach((node) => {
    node.remove();
  });

  document.querySelectorAll("table").forEach((tableNode) => {
    const table = tableNode as HTMLTableElement;
    if (table.dataset.noGlobalPagination === "true") {
      return;
    }

    const body = table.tBodies?.[0];
    if (!body) {
      return;
    }

    const rows = Array.from(body.rows);
    if (rows.length <= PAGE_SIZE) {
      return;
    }

    table.setAttribute("data-global-paginated", "true");

    const totalPages = Math.ceil(rows.length / PAGE_SIZE);
    let currentPage = 1;

    const pager = document.createElement("div");
    pager.setAttribute("data-global-table-pager", "true");
    stylePagerContainer(pager);

    const status = document.createElement("span");
    status.style.fontWeight = "600";

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.alignItems = "center";
    controls.style.gap = "0.35rem";

    const previous = document.createElement("button");
    previous.textContent = "Prev";

    const next = document.createElement("button");
    next.textContent = "Next";

    const update = () => {
      showRowsForPage(rows, currentPage, PAGE_SIZE);
      status.textContent = `Page ${currentPage} of ${totalPages} | ${rows.length} rows`;
      stylePagerButton(previous, currentPage > 1);
      stylePagerButton(next, currentPage < totalPages);
    };

    previous.addEventListener("click", () => {
      if (currentPage <= 1) {
        return;
      }
      currentPage -= 1;
      update();
    });

    next.addEventListener("click", () => {
      if (currentPage >= totalPages) {
        return;
      }
      currentPage += 1;
      update();
    });

    controls.append(previous, next);
    pager.append(status, controls);

    const wrap = table.closest(".table-wrap");
    if (wrap?.parentElement) {
      wrap.insertAdjacentElement("afterend", pager);
    } else if (table.parentElement) {
      table.insertAdjacentElement("afterend", pager);
    }

    update();
  });
}

export function GlobalTablePaginator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queueApply = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        applyTablePagination();
        timer = null;
      }, 40);
    };

    queueApply();

    const observer = new MutationObserver((mutations) => {
      const shouldReapply = mutations.some((mutation) => {
        const target = mutation.target;
        if (target instanceof HTMLTableSectionElement || target instanceof HTMLTableElement || target instanceof HTMLTableRowElement) {
          return true;
        }
        if (target instanceof HTMLElement && target.closest("table")) {
          return true;
        }
        return false;
      });

      if (shouldReapply) {
        queueApply();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [pathname, searchKey]);

  return null;
}



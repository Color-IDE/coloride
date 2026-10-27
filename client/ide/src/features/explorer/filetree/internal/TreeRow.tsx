import { useEffect, useState } from "react";
import { OverflowFadeText } from "../../../../shared/components/OverflowFadeText";
import {
  ChevronIcon,
  FileIcon,
  fileTreeIconColor,
  FolderClosedIcon,
  FolderOpenIcon,
  LoadingSpinnerIcon,
} from "./FileIcons";
import { modKey, renameSelectionRange, TREE_ROW_HEIGHT } from "./model";
import { type FileTreeItem } from "./types";

export function FileTreeSkeleton() {
  return (
    <div
      aria-label="Loading files"
      aria-busy="true"
      className="space-y-1 px-2 py-2"
    >
      {[
        "w-[68%]",
        "w-[52%]",
        "w-[76%]",
        "w-[44%]",
        "w-[62%]",
        "w-[56%]",
        "w-[70%]",
      ].map((width, index) => (
        <div
          className="flex h-[22px] items-center gap-2"
          key={index}
          style={{ paddingLeft: `${Math.min(index % 3, 2) * 16}px` }}
        >
          <span className="skeleton-shimmer size-3.5 shrink-0 rounded-sm" />
          <span className={`skeleton-shimmer h-3 rounded ${width}`} />
        </div>
      ))}
    </div>
  );
}

export function TreeRow({
  active,
  dirty = false,
  pendingAgentReview = false,
  hasError = false,
  multiSelected = false,
  dragging,
  dropTarget,
  editing,
  expanded,
  animateEnter = true,
  item,
  loading,
  onCancelRename,
  onCommitRename,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onFocus,
  onOpenMenu,
  onRenameChange,
  onActivate,
  onStartRename,
  renameValue,
  rowIndex,
  createPlaceholder,
}: {
  active: boolean;
  dirty?: boolean;
  pendingAgentReview?: boolean;
  hasError?: boolean;
  multiSelected?: boolean;
  dragging: boolean;
  dropTarget: boolean;
  editing: boolean;
  expanded: boolean;
  animateEnter?: boolean;
  item: FileTreeItem;
  loading: boolean;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onDragEnd?: () => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDragStart?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent) => void;
  onFocus: () => void;
  onOpenMenu?: (event: React.MouseEvent<HTMLElement>) => void;
  onRenameChange: (value: string) => void;
  onActivate?: (event: React.MouseEvent) => void;
  onStartRename?: () => void;
  renameValue: string;
  rowIndex: number;
  /** When set, this row is an inline create draft (not rename). */
  createPlaceholder?: string;
}) {
  // Workspace root is the first row; nest everything one level so the
  // expand guide line sits under that folder like any other directory.
  const visualDepth = item.depth + 1;
  const paddingLeft = 8 + visualDepth * 16;
  const animationDelay = `${Math.min(visualDepth * 25 + (rowIndex % 4) * 12, 120)}ms`;
  const draggable = Boolean(onDragStart) && !editing && !loading;
  const itemPath = item.path ?? item.id;
  // Play enter animation only once per mount — never again on select/deselect.
  // Disabled while virtualizing so scroll remounts don't flash.
  const [entering, setEntering] = useState(animateEnter);
  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(() => setEntering(false), 220);
    return () => window.clearTimeout(timer);
  }, [entering]);

  return (
    <div
      aria-busy={loading}
      aria-selected={active}
      className={`tree-row-appear group relative flex h-[22px] w-full shrink-0 items-center rounded-[2px] border-0 py-0 pr-2 text-left font-normal outline-none transition-[background-color,color] duration-75 hover:bg-white/[0.05] focus-visible:bg-white/[0.06] focus-visible:outline-none ${
        multiSelected
          ? "tree-row-multi-selected bg-white/[0.09] text-[#f0f4f8]"
          : active
            ? "bg-white/[0.06] text-[#f0f4f8]"
            : "bg-transparent text-[#f0f4f8] hover:text-white"
      } ${editing ? "cursor-text" : draggable ? "cursor-grab active:cursor-grabbing" : ""} ${
        dragging ? "tree-row-dragging opacity-45" : ""
      } ${dropTarget ? "tree-row-drop-target" : ""}`}
      data-clickable={editing ? undefined : "true"}
      data-enter={entering ? "true" : undefined}
      data-tree-path={itemPath}
      draggable={draggable}
      onClick={(event) => {
        if (editing) return;
        // preventScroll avoids the tree jumping when a row takes focus.
        event.currentTarget.focus({ preventScroll: true });
        onFocus();
        onActivate?.(event);
      }}
      onContextMenu={onOpenMenu}
      onDragEnd={onDragEnd}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if (editing) return;
        // Enter / F2 → rename. Space still opens/toggles.
        if (
          (event.key === "Enter" || event.key === "F2") &&
          onStartRename &&
          !modKey(event) &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          onStartRename();
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          onActivate?.(event as unknown as React.MouseEvent);
        }
      }}
      role="treeitem"
      style={{
        animationDelay: entering ? animationDelay : undefined,
        height: TREE_ROW_HEIGHT,
        paddingLeft,
      }}
      tabIndex={editing ? -1 : 0}
    >
      {visualDepth > 0 && (
        <div className="pointer-events-none absolute left-0 top-0 h-full">
          {Array.from({ length: visualDepth }).map((_, index) => (
            <div
              className="absolute top-0 h-full w-px border-l-2 border-[#878888]/20 transition-colors group-hover:border-[#878888]/30"
              key={index}
              // Center the 2px guide on the 14px chevron: 8 + 7 - 1.
              style={{ left: 14 + index * 16 }}
            />
          ))}
        </div>
      )}

      {item.kind === "dir" ? (
        <ChevronIcon
          className={`mr-1 size-3.5 shrink-0 transform-gpu text-[#878888]/50 transition-[transform,color] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:text-[#878888]/70 ${
            expanded ? "" : "-rotate-90"
          }`}
        />
      ) : (
        <span aria-hidden="true" className="mr-1 size-3.5 shrink-0" />
      )}

      {item.kind === "dir" ? (
        expanded ? (
          <FolderOpenIcon
            className={`size-3.5 shrink-0 transition-colors ${hasError ? "text-[#f87171]" : "filetree-folder-color"}`}
          />
        ) : (
          <FolderClosedIcon
            className={`size-3.5 shrink-0 transition-colors ${hasError ? "text-[#f87171]" : "filetree-folder-color"}`}
          />
        )
      ) : (
        <FileIcon
          name={item.name}
          className={`size-3.5 shrink-0 transition-colors ${hasError ? "text-[#f87171]" : fileTreeIconColor(item.name)}`}
        />
      )}

      {editing ? (
        <input
          aria-label={
            createPlaceholder ? createPlaceholder : `Rename ${item.name}`
          }
          autoFocus
          className="ml-1.5 min-w-0 flex-1 rounded-md border-0 bg-[#2c2c2c] px-1.5 py-0.5 text-[13px] text-[#f0f4f8] outline-none placeholder:text-[#5c5c62]"
          onBlur={onCommitRename}
          onChange={(event) => onRenameChange(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onFocus={(event) => {
            const input = event.currentTarget;
            if (createPlaceholder) {
              // New file/folder: caret at end (empty or typed name).
              requestAnimationFrame(() => {
                const len = input.value.length;
                input.setSelectionRange(len, len);
              });
              return;
            }
            const { start, end } = renameSelectionRange(input.value, item.kind);
            // Defer so the browser's default select-all doesn't win the race.
            requestAnimationFrame(() => {
              input.setSelectionRange(start, end);
            });
          }}
          placeholder={createPlaceholder}
          ref={(node) => {
            if (!node || node.dataset.renamePrimed === "1") return;
            node.dataset.renamePrimed = "1";
            requestAnimationFrame(() => {
              node.focus({ preventScroll: true });
              if (createPlaceholder) {
                const len = node.value.length;
                node.setSelectionRange(len, len);
              } else {
                const { start, end } = renameSelectionRange(
                  node.value || item.name,
                  item.kind,
                );
                node.setSelectionRange(start, end);
              }
            });
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              onCommitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancelRename();
            }
          }}
          value={renameValue}
        />
      ) : (
        <OverflowFadeText
          className={`ml-2 flex-1 ${hasError ? "text-[#f87171]" : ""}`}
        >
          {item.name}
        </OverflowFadeText>
      )}
      {loading && (
        <LoadingSpinnerIcon className="ml-1.5 size-3.5 shrink-0 animate-spin text-[#878888] group-hover:text-[#a6a6ad]" />
      )}
      {pendingAgentReview && !editing ? (
        <span
          aria-label="Agent changes pending review"
          className="filetree-agent-review-dot ml-1.5 shrink-0"
          title={
            item.kind === "dir"
              ? "Contains agent changes pending review — Keep or Undo"
              : "Agent changes pending review — Keep or Undo"
          }
        />
      ) : null}
      {dirty && !editing ? (
        <span
          aria-label="Unsaved changes"
          className="filetree-dirty-dot ml-1.5 shrink-0"
          title="Unsaved changes"
        />
      ) : null}
    </div>
  );
}

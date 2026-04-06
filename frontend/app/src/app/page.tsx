"use client";

import type { CSSProperties, FormEvent } from "react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";

type NodeSummary = {
  id: string;
  name: string;
  title: string;
  unit: string;
  parentId: string | null;
  childrenIds: string[];
  depth: number;
  tin: number;
  tout: number;
  subtreeSize: number;
};

type Snapshot = {
  metadata: {
    rootId: string;
    nodeCount: number;
    height: number;
    techniques?: string[];
  };
  root: NodeSummary;
  nodes: NodeSummary[];
};

type LoadPayloadNode = {
  id: string;
  name: string;
  title: string;
  unit: string;
  parentId: string | null;
};

type AddPersonForm = {
  name: string;
  title: string;
  unit: string;
};

type QueryKind =
  | "manager-chain"
  | "subtree"
  | "kth-ancestor"
  | "lowest-common-manager"
  | "distance"
  | "path"
  | "is-ancestor";

type QueryResult = {
  title: string;
  lines: string[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 1.75;
const ZOOM_STEP = 0.1;

const EMPTY_FORM: AddPersonForm = {
  name: "",
  title: "",
  unit: "",
};

const QUERY_OPTIONS: { id: QueryKind; label: string }[] = [
  { id: "manager-chain", label: "Manager chain" },
  { id: "subtree", label: "Subtree" },
  { id: "kth-ancestor", label: "K-th ancestor" },
  { id: "lowest-common-manager", label: "Lowest common manager" },
  { id: "distance", label: "Distance" },
  { id: "path", label: "Path" },
  { id: "is-ancestor", label: "Ancestor check" },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildNodeId(name: string, nodes: NodeSummary[]) {
  const base = slugify(name) || "person";
  const used = new Set(nodes.map((node) => node.id));
  if (!used.has(base)) {
    return base;
  }

  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function toLoadPayload(nodes: NodeSummary[]): LoadPayloadNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    title: node.title,
    unit: node.unit,
    parentId: node.parentId,
  }));
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function buildSelectedPath(nodeId: string | null, nodeMap: Record<string, NodeSummary>) {
  const ids = new Set<string>();
  let currentId = nodeId;

  while (currentId) {
    ids.add(currentId);
    currentId = nodeMap[currentId]?.parentId ?? null;
  }

  return ids;
}

function formatNodeInline(node: Pick<NodeSummary, "name" | "title"> | null | undefined) {
  if (!node) {
    return "None";
  }

  return `${node.name} (${node.title})`;
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  const path = direction === "right" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6";

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.orgChevronIcon}>
      <path d={path} />
    </svg>
  );
}

function TreeNode({
  node,
  nodeMap,
  selectedNodeId,
  highlightedNodeId,
  selectedPathIds,
  siblingIndex,
  onSelect,
}: {
  node: NodeSummary;
  nodeMap: Record<string, NodeSummary>;
  selectedNodeId: string | null;
  highlightedNodeId: string | null;
  selectedPathIds: Set<string>;
  siblingIndex: number;
  onSelect: (nodeId: string) => void;
}) {
  const style = {
    "--depth": String(node.depth),
    "--sibling": String(siblingIndex),
  } as CSSProperties;

  return (
    <li className={styles.orgItem} style={style}>
      <div className={styles.orgNodeShell}>
        <button
          id={`node-${node.id}`}
          className={[
            styles.orgNode,
            selectedNodeId === node.id ? styles.isSelected : "",
            highlightedNodeId === node.id ? styles.isHighlighted : "",
            selectedPathIds.has(node.id) ? styles.isPath : "",
          ]
            .filter(Boolean)
            .join(" ")}
          type="button"
          onClick={() => onSelect(node.id)}
        >
          <span className={styles.orgNodeCircle}>{initials(node.name)}</span>
          <span className={styles.orgNodeName}>{node.name}</span>
          <span className={styles.orgNodeRole}>{node.title}</span>
        </button>
      </div>

      {node.childrenIds.length > 0 ? (
        <ul className={styles.orgChildren}>
          {node.childrenIds.map((childId, index) => {
            const child = nodeMap[childId];
            if (!child) {
              return null;
            }

            return (
              <TreeNode
                key={child.id}
                node={child}
                nodeMap={nodeMap}
                selectedNodeId={selectedNodeId}
                highlightedNodeId={highlightedNodeId}
                selectedPathIds={selectedPathIds}
                siblingIndex={index}
                onSelect={onSelect}
              />
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [form, setForm] = useState<AddPersonForm>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [queryKind, setQueryKind] = useState<QueryKind>("manager-chain");
  const [queryPrimaryNodeId, setQueryPrimaryNodeId] = useState<string | null>(null);
  const [compareNodeId, setCompareNodeId] = useState<string | null>(null);
  const [kValue, setKValue] = useState("1");
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const suppressClickRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    moved: boolean;
  } | null>(null);

  const nodeMap = useMemo(
    () => Object.fromEntries((snapshot?.nodes ?? []).map((node) => [node.id, node])),
    [snapshot],
  );
  const selectedNode = selectedNodeId ? nodeMap[selectedNodeId] : null;
  const selectedPathIds = useMemo(
    () => buildSelectedPath(selectedNodeId, nodeMap),
    [nodeMap, selectedNodeId],
  );
  const queryPrimaryNode = queryPrimaryNodeId ? nodeMap[queryPrimaryNodeId] : null;
  const allNodeOptions = useMemo(
    () =>
      (snapshot?.nodes ?? []).map((node) => ({
        id: node.id,
        label: `${node.name} - ${node.title}`,
      })),
    [snapshot],
  );
  const compareNodeOptions = useMemo(
    () =>
      (snapshot?.nodes ?? [])
        .filter((node) => node.id !== queryPrimaryNodeId)
        .map((node) => ({
          id: node.id,
          label: `${node.name} - ${node.title}`,
        })),
    [queryPrimaryNodeId, snapshot],
  );

  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, options);
    if (!response.ok) {
      const payload = await response.text();
      throw new Error(payload || "Request failed.");
    }
    return response.json() as Promise<T>;
  }

  useEffect(() => {
    async function loadHierarchy() {
      try {
        const nextSnapshot = await request<Snapshot>("/hierarchy");
        startTransition(() => {
          setSnapshot(nextSnapshot);
          setSelectedNodeId(nextSnapshot.root.id);
        });
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load the hierarchy.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadHierarchy();
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }

    setQueryPrimaryNodeId((current) => current ?? selectedNodeId);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!compareNodeOptions.length) {
      setCompareNodeId(null);
      return;
    }

    setCompareNodeId((current) => {
      if (current && compareNodeOptions.some((option) => option.id === current)) {
        return current;
      }
      return compareNodeOptions[0]?.id ?? null;
    });
  }, [compareNodeOptions]);

  useEffect(() => {
    setQueryError(null);
    setQueryResult(null);
  }, [queryKind, queryPrimaryNodeId, compareNodeId, kValue]);

  useEffect(() => {
    if (!snapshot || !viewportRef.current) {
      return;
    }

    const viewport = viewportRef.current;
    viewport.scrollLeft = Math.max((viewport.scrollWidth - viewport.clientWidth) / 2, 0);
    viewport.scrollTop = 0;
  }, [snapshot]);

  useEffect(() => {
    if (!highlightedNodeId) {
      return;
    }

    const element = document.getElementById(`node-${highlightedNodeId}`);
    element?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });

    const timeout = window.setTimeout(() => {
      setHighlightedNodeId(null);
    }, 2200);

    return () => window.clearTimeout(timeout);
  }, [highlightedNodeId]);

  function handleViewportPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: viewport.scrollLeft,
      startTop: viewport.scrollTop,
      moved: false,
    };

    viewport.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function handleViewportPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const dragState = dragStateRef.current;

    if (!viewport || !dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      dragState.moved = true;
    }

    viewport.scrollLeft = dragState.startLeft - deltaX;
    viewport.scrollTop = dragState.startTop - deltaY;
  }

  function finishViewportPan(pointerId?: number) {
    const viewport = viewportRef.current;
    const dragState = dragStateRef.current;

    if (viewport && dragState && pointerId === dragState.pointerId) {
      viewport.releasePointerCapture(pointerId);
    }

    suppressClickRef.current = Boolean(dragState?.moved);
    dragStateRef.current = null;
    setIsPanning(false);
  }

  function handleViewportPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    finishViewportPan(event.pointerId);
  }

  function handleViewportPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    finishViewportPan(event.pointerId);
  }

  function handleViewportClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
    }
  }

  function applyZoom(nextZoom: number) {
    const viewport = viewportRef.current;
    const clampedZoom = clampZoom(nextZoom);
    const currentZoom = zoomRef.current;

    if (clampedZoom === currentZoom) {
      return;
    }

    if (!viewport) {
      setZoom(clampedZoom);
      return;
    }

    const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
    const centerY = viewport.scrollTop + viewport.clientHeight / 2;
    const ratio = clampedZoom / currentZoom;

    setZoom(clampedZoom);

    window.requestAnimationFrame(() => {
      const activeViewport = viewportRef.current;
      if (!activeViewport) {
        return;
      }

      activeViewport.scrollLeft = Math.max(centerX * ratio - activeViewport.clientWidth / 2, 0);
      activeViewport.scrollTop = Math.max(centerY * ratio - activeViewport.clientHeight / 2, 0);
    });
  }

  function handleViewportWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }

    event.preventDefault();
    const direction = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    applyZoom(zoomRef.current + direction);
  }

  async function handleAddPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!snapshot || !selectedNode) {
      return;
    }

    const name = form.name.trim();
    const title = form.title.trim();
    const unit = form.unit.trim() || selectedNode.unit || "General";

    if (!name || !title) {
      setErrorMessage("Please fill in name and title.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const newId = buildNodeId(name, snapshot.nodes);
    const payload = {
      nodes: [
        ...toLoadPayload(snapshot.nodes),
        {
          id: newId,
          name,
          title,
          unit,
          parentId: selectedNode.id,
        },
      ],
    };

    try {
      const nextSnapshot = await request<Snapshot>("/hierarchy/load", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      startTransition(() => {
        setSnapshot(nextSnapshot);
        setSelectedNodeId(newId);
        setHighlightedNodeId(newId);
      });
      setForm(EMPTY_FORM);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to add person.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRunQuery() {
    if (!queryPrimaryNode) {
      return;
    }

    setQueryLoading(true);
    setQueryError(null);

    try {
      let nextResult: QueryResult | null = null;

      switch (queryKind) {
        case "manager-chain": {
          const payload = await request<{
            employee: NodeSummary;
            chain: NodeSummary[];
          }>(`/queries/manager-chain/${queryPrimaryNode.id}`);
          nextResult = {
            title: "Manager chain",
            lines:
              payload.chain.length > 0
                ? [
                    `From closest manager upward: ${payload.chain
                      .map((node) => node.name)
                      .join(" -> ")}`,
                  ]
                : [`${queryPrimaryNode.name} is the root node, so no managers are above it.`],
          };
          break;
        }
        case "subtree": {
          const payload = await request<{
            root: NodeSummary;
            members: NodeSummary[];
            size: number;
          }>(`/queries/subtree/${queryPrimaryNode.id}`);
          nextResult = {
            title: "Subtree",
            lines: [
              `Subtree size: ${payload.size}`,
              `Members in Euler Tour order: ${payload.members.map((node) => node.name).join(" -> ")}`,
            ],
          };
          break;
        }
        case "kth-ancestor": {
          const k = Number.parseInt(kValue, 10);
          if (Number.isNaN(k) || k < 0) {
            throw new Error("Enter a valid non-negative k value.");
          }

          const payload = await request<{
            node: NodeSummary;
            k: number;
            ancestor: NodeSummary | null;
          }>(`/queries/kth-ancestor?nodeId=${queryPrimaryNode.id}&k=${k}`);
          nextResult = {
            title: "K-th ancestor",
            lines: [
              payload.ancestor
                ? `${k} jump(s) above ${queryPrimaryNode.name}: ${formatNodeInline(payload.ancestor)}`
                : `${k} jump(s) above ${queryPrimaryNode.name}: no ancestor exists at that level.`,
            ],
          };
          break;
        }
        case "lowest-common-manager": {
          if (!compareNodeId) {
            throw new Error("Pick a second node for this query.");
          }

          const payload = await request<{
            first: NodeSummary;
            second: NodeSummary;
            manager: NodeSummary;
          }>(`/queries/lowest-common-manager?firstId=${queryPrimaryNode.id}&secondId=${compareNodeId}`);
          nextResult = {
            title: "Lowest common manager",
            lines: [
              `${payload.first.name} and ${payload.second.name} meet at ${formatNodeInline(payload.manager)}.`,
            ],
          };
          break;
        }
        case "distance": {
          if (!compareNodeId) {
            throw new Error("Pick a second node for this query.");
          }

          const payload = await request<{
            first: NodeSummary;
            second: NodeSummary;
            edges: number;
          }>(`/queries/distance?firstId=${queryPrimaryNode.id}&secondId=${compareNodeId}`);
          nextResult = {
            title: "Distance",
            lines: [
              `${payload.first.name} to ${payload.second.name}: ${payload.edges} edge(s) apart.`,
            ],
          };
          break;
        }
        case "path": {
          if (!compareNodeId) {
            throw new Error("Pick a second node for this query.");
          }

          const payload = await request<{
            first: NodeSummary;
            second: NodeSummary;
            path: NodeSummary[];
            hops: number;
          }>(`/queries/path?firstId=${queryPrimaryNode.id}&secondId=${compareNodeId}`);
          nextResult = {
            title: "Path",
            lines: [
              `Hop count: ${payload.hops}`,
              `Path: ${payload.path.map((node) => node.name).join(" -> ")}`,
            ],
          };
          break;
        }
        case "is-ancestor": {
          if (!compareNodeId) {
            throw new Error("Pick a second node for this query.");
          }

          const payload = await request<{
            ancestor: NodeSummary;
            node: NodeSummary;
            result: boolean;
          }>(`/queries/is-ancestor?ancestorId=${queryPrimaryNode.id}&nodeId=${compareNodeId}`);
          nextResult = {
            title: "Ancestor check",
            lines: [
              payload.result
                ? `${payload.ancestor.name} is an ancestor of ${payload.node.name}.`
                : `${payload.ancestor.name} is not an ancestor of ${payload.node.name}.`,
              `Euler interval test: [${payload.ancestor.tin}, ${payload.ancestor.tout}] vs [${payload.node.tin}, ${payload.node.tout}]`,
            ],
          };
          break;
        }
      }

      setQueryResult(nextResult);
    } catch (error) {
      setQueryResult(null);
      setQueryError(error instanceof Error ? error.message : "Unable to run the query.");
    } finally {
      setQueryLoading(false);
    }
  }

  const queryNeedsSecondNode =
    queryKind === "lowest-common-manager" ||
    queryKind === "distance" ||
    queryKind === "path" ||
    queryKind === "is-ancestor";
  const queryFirstLabel = queryKind === "is-ancestor" ? "Ancestor node" : "First node";
  const querySecondLabel =
    queryKind === "is-ancestor"
      ? "Descendant node"
      : queryKind === "lowest-common-manager"
        ? "Second node"
        : queryKind === "distance"
          ? "Second node"
          : queryKind === "path"
            ? "Second node"
            : "Second node";

  const queryPanelContent = queryPrimaryNode ? (
    <div className={styles.orgQueryPanel}>
      <div className={styles.orgQueryPanelHead}>
        <p className={styles.orgLabel}>Query lab</p>
        <h2 className={styles.orgQueryPanelTitle}>Run tree queries</h2>
        <p className={styles.orgQueryPanelCopy}>
          Pick the exact node inputs for each query here, then add a second node or a k value only
          when that query needs it.
        </p>
      </div>

      <div className={styles.orgQueryPanelBody}>
        <label className={styles.orgField}>
          <span>{queryFirstLabel}</span>
          <select
            className={styles.orgSelect}
            value={queryPrimaryNodeId ?? ""}
            onChange={(event) => setQueryPrimaryNodeId(event.target.value)}
          >
            {allNodeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.orgField}>
          <span>Query type</span>
          <select
            className={styles.orgSelect}
            value={queryKind}
            onChange={(event) => setQueryKind(event.target.value as QueryKind)}
          >
            {QUERY_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {queryNeedsSecondNode ? (
          <label className={styles.orgField}>
            <span>{querySecondLabel}</span>
            <select
              className={styles.orgSelect}
              value={compareNodeId ?? ""}
              onChange={(event) => setCompareNodeId(event.target.value)}
            >
              {compareNodeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {queryKind === "kth-ancestor" ? (
          <label className={styles.orgField}>
            <span>K value</span>
            <input
              className={styles.orgInput}
              inputMode="numeric"
              value={kValue}
              onChange={(event) => setKValue(event.target.value)}
              placeholder="Enter 0, 1, 2..."
            />
          </label>
        ) : null}

        <button
          type="button"
          className={styles.orgQueryRun}
          disabled={queryLoading}
          onClick={handleRunQuery}
        >
          {queryLoading ? "Running..." : "Run query"}
        </button>

        {queryError ? <div className={styles.orgInlineError}>{queryError}</div> : null}

        {queryResult ? (
          <div className={styles.orgQueryResult}>
            <strong>{queryResult.title}</strong>
            {queryResult.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : (
          <div className={styles.orgQueryHint}>
            Available queries: manager chain, subtree, k-th ancestor, lowest common manager,
            distance, path, and ancestor check.
          </div>
        )}
      </div>
    </div>
  ) : (
    <div className={styles.orgEmpty}>Select a node to start running queries.</div>
  );

  const sidebarContent = selectedNode ? (
    <div className={styles.orgPanel}>
      <div className={styles.orgPanelBody}>
        <section className={styles.orgPanelSection}>
          <div className={styles.orgSectionHead}>
            <p className={styles.orgLabel}>Tree data</p>
            <span className={styles.orgSectionHint}>Live values for the selected node</span>
          </div>
          <div className={styles.orgStatGrid}>
            <div className={styles.orgStat}>
              <span>Level</span>
              <strong>{selectedNode.depth + 1}</strong>
            </div>
            <div className={styles.orgStat}>
              <span>Subtree</span>
              <strong>{selectedNode.subtreeSize}</strong>
            </div>
            <div className={styles.orgStat}>
              <span>Euler in</span>
              <strong>{selectedNode.tin}</strong>
            </div>
            <div className={styles.orgStat}>
              <span>Euler out</span>
              <strong>{selectedNode.tout}</strong>
            </div>
          </div>
        </section>

        <section className={styles.orgPanelSection}>
          <div className={styles.orgSectionHead}>
            <p className={styles.orgLabel}>Add person</p>
            <span className={styles.orgSectionHint}>New nodes attach directly under {selectedNode.name}</span>
          </div>
          <form className={styles.orgForm} onSubmit={handleAddPerson}>
            <label className={styles.orgField}>
              <span>Name</span>
              <input
                className={styles.orgInput}
                placeholder="Full name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label className={styles.orgField}>
              <span>Title</span>
              <input
                className={styles.orgInput}
                placeholder="Role"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
              />
            </label>
            <label className={styles.orgField}>
              <span>Team</span>
              <input
                className={styles.orgInput}
                placeholder="Finance, Executive, CEO Office..."
                value={form.unit}
                onChange={(event) =>
                  setForm((current) => ({ ...current, unit: event.target.value }))
                }
              />
            </label>
            {errorMessage ? <div className={styles.orgInlineError}>{errorMessage}</div> : null}
            <div className={styles.orgFormAction}>
              <button className={styles.orgSubmit} disabled={isSubmitting} type="submit">
                {isSubmitting ? "Adding..." : "Add person"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  ) : (
    <div className={styles.orgEmpty}>Select a node from the tree.</div>
  );

  return (
    <main className={styles.orgApp}>
      <div className={styles.orgLayout}>
        <aside className={styles.orgQuerySidebar}>{queryPanelContent}</aside>

        <section className={styles.orgStage}>
          <header className={styles.orgStageHeader}>
            <div className={styles.orgStageIntro}>
              <h1 className={styles.orgHeading}>Hierarchy Tree</h1>
            </div>
          </header>

          {loading ? (
            <div className={styles.orgEmpty}>Loading tree...</div>
          ) : errorMessage && !snapshot ? (
            <div className={styles.orgError}>{errorMessage}</div>
          ) : snapshot ? (
            <div
              ref={viewportRef}
              className={[
                styles.orgViewport,
                isPanning ? styles.isPanning : "",
                sidebarCollapsed ? styles.orgViewportPanelCollapsed : "",
              ].join(" ")}
              onPointerDown={handleViewportPointerDown}
              onPointerMove={handleViewportPointerMove}
              onPointerUp={handleViewportPointerUp}
              onPointerCancel={handleViewportPointerCancel}
              onClickCapture={handleViewportClickCapture}
              onWheel={handleViewportWheel}
            >
              <div className={styles.orgTreeCanvas} style={{ zoom }}>
                <div className={styles.orgTreeWrap}>
                  <ul className={styles.orgRoot}>
                    <TreeNode
                      node={snapshot.root}
                      nodeMap={nodeMap}
                      selectedNodeId={selectedNodeId}
                      highlightedNodeId={highlightedNodeId}
                      selectedPathIds={selectedPathIds}
                      siblingIndex={0}
                      onSelect={setSelectedNodeId}
                    />
                  </ul>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <aside
          className={[
            styles.orgSidebar,
            sidebarCollapsed ? styles.orgSidebarCollapsed : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <button
            className={styles.orgSidebarToggle}
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? "Open details panel" : "Collapse details panel"}
          >
            <ChevronIcon direction={sidebarCollapsed ? "left" : "right"} />
          </button>

          {sidebarCollapsed ? (
            <div className={styles.orgSidebarPeek}>
              <span className={styles.orgSidebarPeekCircle}>
                {initials(selectedNode?.name ?? "Tree")}
              </span>
            </div>
          ) : null}

          {!sidebarCollapsed ? sidebarContent : null}
        </aside>
      </div>
    </main>
  );
}

import React, { useMemo, useState } from 'react';
import { Eye, Network, Tag, X } from 'lucide-react';
import type { KnowledgeTile } from '../types';

interface KnowledgeGraphCanvasProps {
  tiles: KnowledgeTile[];
  onSelectTile: (tile: KnowledgeTile) => void;
  onClose: () => void;
}

interface GraphCategoryGroup {
  category: string;
  color: string;
  tiles: KnowledgeTile[];
  cx: number;
  cy: number;
}

const CATEGORY_COLORS: Record<string, { bg: string; stroke: string; fill: string; text: string }> = {
  Cennik: { bg: '#FEF3C7', stroke: '#F59E0B', fill: '#D97706', text: '#92400E' },
  Technologia: { bg: '#E0E7FF', stroke: '#6366F1', fill: '#4F46E5', text: '#3730A3' },
  Logistyka: { bg: '#ECFDF5', stroke: '#10B981', fill: '#059669', text: '#065F46' },
  Finansowanie: { bg: '#FCE7F3', stroke: '#EC4899', fill: '#DB2777', text: '#9D174D' },
  Gwarancja: { bg: '#E0F2FE', stroke: '#0EA5E9', fill: '#0284C7', text: '#075985' },
  'Wyuczone przez AI': { bg: '#F3E8FF', stroke: '#A855F7', fill: '#9333EA', text: '#6B21A8' },
};

const DEFAULT_COLOR = { bg: '#F1F5F9', stroke: '#94A3B8', fill: '#64748B', text: '#334155' };

export const KnowledgeGraphCanvas: React.FC<KnowledgeGraphCanvasProps> = ({
  tiles,
  onSelectTile,
  onClose,
}) => {
  const [hoveredTile, setHoveredTile] = useState<KnowledgeTile | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Grupowanie kafelków według kategorii
  const groups = useMemo(() => {
    const map = new Map<string, KnowledgeTile[]>();
    for (const t of tiles) {
      const cat = t.category || 'Ogólne';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(t);
    }

    const categories = Array.from(map.keys());
    const width = 800;
    const height = 500;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    return categories.map((cat, idx): GraphCategoryGroup => {
      const angle = (idx / categories.length) * 2 * Math.PI - Math.PI / 2;
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);
      const colorScheme = CATEGORY_COLORS[cat] || DEFAULT_COLOR;

      return {
        category: cat,
        color: colorScheme.stroke,
        tiles: map.get(cat)!,
        cx,
        cy,
      };
    });
  }, [tiles]);

  // Obliczanie powiązań między kafelkami (wspólne słowa kluczowe w tytułach / treści)
  const links = useMemo(() => {
    const list: Array<{ x1: number; y1: number; x2: number; y2: number; strength: number }> = [];
    const width = 800;
    const height = 500;
    const centerX = width / 2;
    const centerY = height / 2;

    for (const g of groups) {
      list.push({
        x1: centerX,
        y1: centerY,
        x2: g.cx,
        y2: g.cy,
        strength: Math.min(g.tiles.length, 6),
      });
    }
    return list;
  }, [groups]);

  return (
    <div className="rounded-3xl border border-indigo-200 bg-slate-950 p-5 text-white shadow-xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      {/* Nagłówek wizualizatora */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <Network className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              Wizualna Mapa Bazy Wiedzy (Knowledge Graph)
              <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 border border-indigo-500/30">
                {tiles.length} kafelków
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Interaktywna topologia kategorii i klastrów wiedzy firmowej. Najedź lub kliknij węzeł, aby przejść do szczegółów.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          title="Zamknij mapę"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* SVG Canvas */}
      <div className="relative flex justify-center">
        <svg viewBox="0 0 800 500" className="w-full max-w-3xl h-[420px] select-none">
          {/* Linie powiązań od środka (Hub) do kategorii */}
          {links.map((link, i) => (
            <line
              key={i}
              x1={link.x1}
              y1={link.y1}
              x2={link.x2}
              y2={link.y2}
              stroke="#334155"
              strokeWidth={Math.max(1.5, link.strength * 0.8)}
              strokeDasharray="4 3"
              className="opacity-60"
            />
          ))}

          {/* Centralny Hub — Rdzeń Wiedzy BizOps */}
          <g>
            <circle cx="400" cy="250" r="38" fill="#1E1B4B" stroke="#6366F1" strokeWidth="2.5" />
            <text x="400" y="246" textAnchor="middle" fill="#A5B4FC" fontSize="11" fontWeight="bold">
              BizOps BAZA
            </text>
            <text x="400" y="262" textAnchor="middle" fill="#64748B" fontSize="9">
              {tiles.length} reguł
            </text>
          </g>

          {/* Klastry kategorii */}
          {groups.map((g) => {
            const isSelected = selectedCategory === g.category;
            const colors = CATEGORY_COLORS[g.category] || DEFAULT_COLOR;

            return (
              <g
                key={g.category}
                className="cursor-pointer transition-transform hover:scale-105"
                onClick={() => setSelectedCategory(isSelected ? null : g.category)}
              >
                {/* Otoczka klastra */}
                <circle
                  cx={g.cx}
                  cy={g.cy}
                  r={Math.min(52, 28 + g.tiles.length * 2.2)}
                  fill={colors.bg}
                  fillOpacity="0.12"
                  stroke={colors.stroke}
                  strokeWidth={isSelected ? '3' : '1.5'}
                />

                {/* Środek kategorii */}
                <circle cx={g.cx} cy={g.cy} r="18" fill={colors.fill} />
                <text x={g.cx} y={g.cy + 4} textAnchor="middle" fill="#FFFFFF" fontSize="10" fontWeight="bold">
                  {g.tiles.length}
                </text>

                {/* Etykieta kategorii */}
                <text
                  x={g.cx}
                  y={g.cy > 250 ? g.cy + 34 : g.cy - 30}
                  textAnchor="middle"
                  fill="#E2E8F0"
                  fontSize="11"
                  fontWeight="bold"
                >
                  {g.category}
                </text>

                {/* Sub-węzły kafelków wokół kategorii */}
                {g.tiles.slice(0, 10).map((t, ti) => {
                  const subAngle = (ti / Math.min(g.tiles.length, 10)) * 2 * Math.PI;
                  const subR = Math.min(48, 24 + g.tiles.length * 1.8);
                  const sx = g.cx + subR * Math.cos(subAngle);
                  const sy = g.cy + subR * Math.sin(subAngle);

                  return (
                    <circle
                      key={t.id}
                      cx={sx}
                      cy={sy}
                      r="4.5"
                      fill={t.enabled ? colors.stroke : '#64748B'}
                      className="cursor-pointer hover:r-7 transition-all"
                      onMouseEnter={() => setHoveredTile(t)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTile(t);
                      }}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip z podglądem wybranego kafelka */}
        {hoveredTile && (
          <div className="absolute top-4 left-4 max-w-xs rounded-2xl border border-indigo-400/40 bg-slate-900/95 p-3 text-xs shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-bold text-indigo-300 flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {hoveredTile.category}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${hoveredTile.enabled ? 'bg-emerald-900/80 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {hoveredTile.enabled ? 'Aktywny' : 'Wyłączony'}
              </span>
            </div>
            <p className="font-semibold text-white">{hoveredTile.title}</p>
            <p className="mt-1 text-[11px] text-slate-300 line-clamp-3 leading-relaxed">
              {hoveredTile.content}
            </p>
            <button
              type="button"
              onClick={() => onSelectTile(hoveredTile)}
              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-indigo-500"
            >
              <Eye className="h-3 w-3" />
              Edytuj ten kafelek
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

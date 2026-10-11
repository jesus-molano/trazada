"""Utilidades geométricas de polilíneas (en metros)."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import cKDTree


def seglen(points: np.ndarray, closed: bool = False) -> np.ndarray:
    pts = np.vstack([points, points[:1]]) if closed else points
    return np.linalg.norm(np.diff(pts[:, :2], axis=0), axis=1)


def arclength(points: np.ndarray, closed: bool = False) -> np.ndarray:
    """Distancia acumulada (2D) en cada vértice; con closed=True añade el tramo de cierre al final."""
    return np.concatenate([[0.0], np.cumsum(seglen(points, closed))])


def resample(points: np.ndarray, step: float, closed: bool) -> np.ndarray:
    """Remuestrea a paso fijo por longitud de arco (2D); interpola también z."""
    pts = np.vstack([points, points[:1]]) if closed else points
    u = arclength(points, closed)
    total = u[-1]
    n = max(2, int(np.floor(total / step)) + (0 if closed else 1))
    targets = np.arange(n) * step if closed else np.linspace(0.0, total, n)
    keep = np.r_[True, np.diff(u) > 1e-9]
    return np.column_stack([np.interp(targets, u[keep], pts[keep, k]) for k in range(pts.shape[1])])


def smooth_closed(points: np.ndarray, sigma: float) -> np.ndarray:
    return np.column_stack(
        [gaussian_filter1d(points[:, k], sigma, mode="wrap") for k in range(points.shape[1])]
    )


def smooth_open(points: np.ndarray, sigma: float) -> np.ndarray:
    return np.column_stack(
        [gaussian_filter1d(points[:, k], sigma, mode="nearest") for k in range(points.shape[1])]
    )


def rotate_xy(points: np.ndarray, degrees: float) -> np.ndarray:
    """Rotación antihoraria (convención del ejemplo de FastF1 para `CircuitInfo.rotation`)."""
    a = np.deg2rad(degrees)
    c, s = np.cos(a), np.sin(a)
    out = points.astype(np.float64).copy()
    x, y = points[:, 0], points[:, 1]
    out[:, 0] = x * c - y * s
    out[:, 1] = x * s + y * c
    return out


class PolylineIndex:
    """Proyección de puntos sobre una polilínea densa (cerrada o abierta) con búsqueda 3D.

    Devuelve la longitud de arco del pie de la perpendicular, refinada sobre el segmento, y la
    distancia. La búsqueda 3D (con la z) distingue cruces a distinta altura (p. ej. Suzuka).
    """

    def __init__(self, points: np.ndarray, closed: bool, z_weight: float = 1.0) -> None:
        self.points = np.asarray(points, dtype=np.float64)
        self.closed = closed
        self.n = len(self.points)
        self.u = arclength(self.points, closed)  # n+1 si cerrada
        self.length = float(self.u[-1])
        nxt = np.roll(self.points, -1, axis=0) if closed else np.vstack([self.points[1:], self.points[-1:]])
        d = nxt[:, :2] - self.points[:, :2]
        if not closed:
            d[-1] = self.points[-1, :2] - self.points[-2, :2]
        norm = np.linalg.norm(d, axis=1, keepdims=True)
        self.tangent = d / np.where(norm > 0, norm, 1.0)
        self.seg = np.linalg.norm(d, axis=1)
        self.z_weight = z_weight
        self._tree = cKDTree(np.column_stack([self.points[:, :2], self.points[:, 2] * z_weight]))

    def _refine(self, p: np.ndarray, i: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        rel = p[:, :2] - self.points[i, :2]
        along = np.einsum("ij,ij->i", rel, self.tangent[i])
        along = np.clip(along, -0.5 * self.seg[np.maximum(i - 1, 0)], self.seg[i])
        foot = self.points[i, :2] + self.tangent[i] * along[:, None]
        dist2d = np.linalg.norm(p[:, :2] - foot, axis=1)
        u = self.u[i] + along
        u = np.mod(u, self.length) if self.closed else np.clip(u, 0.0, self.length)
        return u, dist2d

    def project(self, p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Proyección global (vecino más cercano 3D)."""
        p = np.atleast_2d(np.asarray(p, dtype=np.float64))
        q = np.column_stack([p[:, :2], p[:, 2] * self.z_weight])
        _, i = self._tree.query(q)
        return self._refine(p, np.asarray(i))

    def project_candidates(self, p: np.ndarray, k: int = 8) -> tuple[np.ndarray, np.ndarray]:
        """Hasta k candidatos (u, distancia) por punto, para elegir por continuidad."""
        p = np.atleast_2d(np.asarray(p, dtype=np.float64))
        q = np.column_stack([p[:, :2], p[:, 2] * self.z_weight])
        _, idx = self._tree.query(q, k=min(k, self.n))
        idx = np.atleast_2d(idx)
        us = np.empty(idx.shape)
        ds = np.empty(idx.shape)
        for j in range(idx.shape[1]):
            us[:, j], ds[:, j] = self._refine(p, idx[:, j])
        return us, ds

    def point_at(self, u: np.ndarray) -> np.ndarray:
        u = np.asarray(u, dtype=np.float64)
        pts = np.vstack([self.points, self.points[:1]]) if self.closed else self.points
        uu = self.u if self.closed else self.u[: len(pts)]
        if self.closed:
            u = np.mod(u, self.length)
        return np.column_stack([np.interp(u, uu, pts[:, k]) for k in range(3)])

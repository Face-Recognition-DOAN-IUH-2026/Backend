const EARTH_RADIUS_METERS = 6371e3;

/**
 * Sai số GPS cho phép khi so khớp vị trí. Thiết bị di động thường lệch 5-15m
 * so với toạ độ thật, cộng thêm sai số làm tròn của tâm geofence.
 */
export const GPS_TOLERANCE_METERS = 15;

export function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = EARTH_RADIUS_METERS;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeofenceArea {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface GeofenceEvaluation {
  /** Vị trí có nằm trong vùng cho phép (đã cộng sai số GPS) hay không. */
  allowed: boolean;
  /** Khoảng cách Haversine thực tế từ thiết bị tới tâm geofence. */
  distanceMeters: number;
  /** Bán kính hiệu dụng = bán kính cấu hình + sai số GPS. */
  effectiveRadiusMeters: number;
  /** Số mét vượt quá bán kính (0 nếu nằm trong vùng). */
  overflowMeters: number;
  reason: string;
}

export function isValidCoordinate(lat?: number | null, lng?: number | null): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * So khớp vị trí thiết bị với tâm geofence theo công thức Haversine.
 * Bán kính hiệu dụng = radiusMeters + toleranceMeters để bù sai số GPS.
 */
export function evaluateGeofence(
  userLat: number,
  userLng: number,
  area: GeofenceArea,
  toleranceMeters: number = GPS_TOLERANCE_METERS
): GeofenceEvaluation {
  const distanceMeters = haversineDistanceMeters(userLat, userLng, area.latitude, area.longitude);
  const effectiveRadiusMeters = area.radiusMeters + toleranceMeters;
  const allowed = distanceMeters <= effectiveRadiusMeters;

  return {
    allowed,
    distanceMeters,
    effectiveRadiusMeters,
    overflowMeters: allowed ? 0 : Math.round(distanceMeters - effectiveRadiusMeters),
    reason: allowed
      ? `Trong vùng cho phép (${Math.round(distanceMeters)}m / ${area.radiusMeters}m)`
      : `Ngoài vùng cho phép (${Math.round(distanceMeters)}m / ${area.radiusMeters}m)`,
  };
}

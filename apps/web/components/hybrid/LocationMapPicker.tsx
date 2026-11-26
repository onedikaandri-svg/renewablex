"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { isValidCoordinatePair, roundCoordinate } from "@/lib/location-utils";

export interface LocationMapPickerProps {
  latitude: number;
  longitude: number;
  onChange: (latitude: number, longitude: number) => void;
}

function createPinIcon(): L.DivIcon {
  const html = `
    <span class="rx-map-pin-inner" aria-hidden="true">
      <svg width="30" height="38" viewBox="0 0 30 38" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 1.5C7.544 1.5 1.5 7.544 1.5 15C1.5 24.45 13.38 35.19 14.33 36.03C14.71 36.37 15.29 36.37 15.67 36.03C16.62 35.19 28.5 24.45 28.5 15C28.5 7.544 22.456 1.5 15 1.5Z" fill="#533AFD" stroke="#FFFFFF" stroke-width="2.2"/>
        <circle cx="15" cy="14.5" r="5" fill="#FFFFFF"/>
      </svg>
    </span>
  `;
  return L.divIcon({
    className: "rx-map-pin",
    html,
    iconSize: [30, 38],
    iconAnchor: [15, 37],
  });
}

export default function LocationMapPicker({
  latitude,
  longitude,
  onChange,
}: LocationMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const safeLat = isValidCoordinatePair(latitude, longitude) ? latitude : -6.20;
  const safeLon = isValidCoordinatePair(latitude, longitude) ? longitude : 106.80;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [safeLat, safeLon],
      zoom: 11,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors (ODbL)',
    }).addTo(map);

    const marker = L.marker([safeLat, safeLon], {
      draggable: true,
      icon: createPinIcon(),
      title: "Geser pin untuk memilih titik lokasi proyek",
      alt: "Pin lokasi proyek energi hybrid",
    }).addTo(map);

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onChangeRef.current(roundCoordinate(pos.lat, 5), roundCoordinate(pos.lng, 5));
    });

    map.on("click", (evt: L.LeafletMouseEvent) => {
      const nextLat = roundCoordinate(evt.latlng.lat, 5);
      const nextLon = roundCoordinate(evt.latlng.lng, 5);
      marker.setLatLng([nextLat, nextLon]);
      onChangeRef.current(nextLat, nextLon);
    });

    mapRef.current = map;
    markerRef.current = marker;

    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 120);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Inisialisasi peta hanya sekali saat komponen terpasang
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !isValidCoordinatePair(latitude, longitude)) return;

    const current = marker.getLatLng();
    const diff = Math.abs(current.lat - latitude) + Math.abs(current.lng - longitude);
    if (diff < 0.00001) return;

    marker.setLatLng([latitude, longitude]);
    map.setView([latitude, longitude], map.getZoom(), { animate: true });
  }, [latitude, longitude]);

  return (
    <div className="location-map-shell">
      <div
        ref={containerRef}
        className="location-map-canvas"
        role="region"
        aria-label="Peta interaktif pemilihan titik lokasi proyek. Klik peta atau geser pin untuk mengubah lintang dan bujur."
      />
    </div>
  );
}

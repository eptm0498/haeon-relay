"use client";

import { useState } from "react";

const palettes = [
  ["#a5d7ff", "#73b8fa", "#4c9ff2"],
  ["#b0eee4", "#6bd2c6", "#38b4ab"],
  ["#d8d2ff", "#aaa1f7", "#9185ed"],
  ["#a0e6df", "#62ccc5", "#31b0a8"],
];

function defaultAvatar(name: string) {
  let hash = 0;
  for (const letter of name) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  const [top, bottom, person] = palettes[hash % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><path fill="url(#bg)" d="M72 0C19 0 0 19 0 72s19 72 72 72 72-19 72-72S125 0 72 0Z"/><circle cx="72" cy="57" r="17" fill="${person}"/><path fill="${person}" d="M42 94c0-11 13-19 30-19s30 8 30 19c0 8-13 10-30 10s-30-2-30-10Z"/></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

export default function CharacterAvatar({ name, src, alt = "" }: {
  name: string; src?: string | null; alt?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const photo = src && src !== failedSource ? src : defaultAvatar(name);
  return <img src={photo} alt={alt} draggable={false}
    style={{width:"100%", height:"100%", objectFit:"cover", display:"block"}}
    onError={() => { if (src) setFailedSource(src); }}/>;
}

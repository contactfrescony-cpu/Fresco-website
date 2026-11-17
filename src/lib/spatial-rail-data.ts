export interface Garment {
  id: string;
  name: string;
  colour: string;
  price: number;
  line: string;
  material: string;
  sizes: string[];
}

export interface GarmentArt {
  color: string;
  views: string[];
  bottom: number;
  half: number;
}

export const BRAND = {
  name: "Spatial Rail",
  line: "Clothing in natural cloth, cut to be layered and worn for years.",
  email: "hello@spatialrail.example",
  phone: "020 0000 0000",
};

export const GARMENTS: Garment[] = [
  { id: "shirts", name: "Shirts & Overshirts", colour: "Olive", price: 0, line: "Woven structures, prints, checks, trims and distinctive construction.", material: "Fresco collection", sizes: [] },
  { id: "polos", name: "Polo Shirts", colour: "Navy", price: 0, line: "Pique, knitted and printed polos with refined collars and finishing.", material: "Fresco collection", sizes: [] },
  { id: "tshirts", name: "T-Shirts", colour: "Natural", price: 0, line: "Core essentials, graphics, jacquards and surface treatments.", material: "Fresco collection", sizes: [] },
  { id: "hoodies", name: "Sweatshirts & Hoodies", colour: "Grey", price: 0, line: "Fleece, brushed and textured surfaces with considered finishing.", material: "Fresco collection", sizes: [] },
  { id: "outerwear", name: "Outerwear", colour: "Burgundy", price: 0, line: "Jackets and layers with considered materials and functional detailing.", material: "Fresco collection", sizes: [] },
  { id: "denim", name: "Denim", colour: "Indigo", price: 0, line: "Five-pocket denim across washes, fits and finishes.", material: "Fresco collection", sizes: [] },
  { id: "trousers", name: "Trousers", colour: "Charcoal", price: 0, line: "Chinos, joggers and utility trousers with clean construction.", material: "Fresco collection", sizes: [] },
  { id: "shorts", name: "Shorts", colour: "Forest", price: 0, line: "Terry, printed and woven shorts for warm-season ranges.", material: "Fresco collection", sizes: [] },
];

export const ART = {
  canvas: { w: 1000, h: 1667, hookY: 113 },
  garments: {
    shirts: { color: "#596044", views: ["front"], bottom: 1450, half: 486 },
    polos: { color: "#243b55", views: ["front"], bottom: 1290, half: 465 },
    tshirts: { color: "#d1c8b5", views: ["front"], bottom: 1260, half: 470 },
    hoodies: { color: "#a5a5a2", views: ["front"], bottom: 1460, half: 485 },
    outerwear: { color: "#6f3034", views: ["front"], bottom: 1440, half: 480 },
    denim: { color: "#30465d", views: ["front"], bottom: 1570, half: 330 },
    trousers: { color: "#313133", views: ["front"], bottom: 1580, half: 315 },
    shorts: { color: "#173e32", views: ["front"], bottom: 1290, half: 455 },
  } as Record<string, GarmentArt>,
};

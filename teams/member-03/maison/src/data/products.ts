// 타입과 컬렉션 메타데이터만 둔다.
// 상품 데이터는 server/data.ts 로 옮겼고 /api/products 로 받아온다.
// 컬렉션은 Header·Footer 네비게이션이 모든 화면에서 쓰는 5개 항목이라
// AJAX 로 받으면 네비가 깜빡여 접근성 트리와 state_key 가 불안정해진다.

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
  heroImage?: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  collection: string;
  price: number;
  description: string;
  longDescription: string;
  materials: string;
  dimensions?: string;
  images: string[];
  featured?: boolean;
  new?: boolean;
}

export const collections: Collection[] = [
  {
    id: "lighting",
    name: "Lighting",
    slug: "lighting",
    description: "Sculptural forms that cast warmth and shadow",
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&q=80",
    heroImage: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=1920&q=80",
  },
  {
    id: "ceramics",
    name: "Ceramics",
    slug: "ceramics",
    description: "Handcrafted vessels shaped by patient hands",
    image: "https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=800&q=80",
    heroImage: "https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=1920&q=80",
  },
  {
    id: "furniture",
    name: "Furniture",
    slug: "furniture",
    description: "Timeless pieces built for generations",
    image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80",
    heroImage: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1920&q=80",
  },
  {
    id: "textiles",
    name: "Textiles",
    slug: "textiles",
    description: "Natural fibers woven with intention",
    image: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=800&q=80",
    heroImage: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1920&q=80",
  },
  {
    id: "objects",
    name: "Objects & Vases",
    slug: "objects",
    description: "Curated details that complete a space",
    image: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=800&q=80",
    heroImage: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=1920&q=80",
  },
  {
    id: "seasonal",
    name: "Seasonal Collection",
    slug: "seasonal",
    description: "Limited pieces inspired by the changing light",
    image: "https://images.unsplash.com/photo-1602028915047-37269d1a73f7?w=800&q=80",
    heroImage: "https://images.unsplash.com/photo-1602028915047-37269d1a73f7?w=1920&q=80",
  },
  {
    id: "new",
    name: "New Arrivals",
    slug: "new-arrivals",
    description: "The latest additions to our collection",
    image: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=80",
    heroImage: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1920&q=80",
  },
  {
    id: "gifts",
    name: "Curated Gifts",
    slug: "gifts",
    description: "Thoughtfully selected pieces for giving",
    image: "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=800&q=80",
    heroImage: "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=1920&q=80",
  },
];


export const getCollectionBySlug = (slug: string): Collection | undefined => {
  return collections.find((collection) => collection.slug === slug);
};

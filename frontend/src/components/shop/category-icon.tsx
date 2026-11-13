import {
  Baby, BookOpen, Briefcase, Car, Dumbbell, Footprints, Gamepad2, Gift, HeartPulse, Home, Laptop, LayoutGrid, Leaf, Luggage, Palette, PawPrint,
  PenTool, Shirt, ShoppingBasket, Sparkles, SprayCan, Wrench,
} from 'lucide-react';

const MAP: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  'fashion-and-apparel': Shirt,
  'electronics-and-technology': Laptop,
  'home-kitchen-and-living': Home,
  'sports-and-outdoors': Dumbbell,
  'beauty-and-personal-care': Sparkles,
  'toys-games-and-hobbies': Gamepad2,
  'automotive-and-industrial': Car,
  'health-wellness-and-medical': HeartPulse,
  'baby-and-maternity': Baby,
  'pet-supplies': PawPrint,
  'tools-hardware-and-home-improvement': Wrench,
  'office-and-school-supplies': PenTool,
  'books-media-and-entertainment': BookOpen,
  'food-and-gourmet-grocery': ShoppingBasket,
  'household-and-cleaning-supplies': SprayCan,
  'garden-and-outdoor-living': Leaf,
  'travel-and-luggage': Luggage,
  'arts-crafts-and-creative-supplies': Palette,
  'party-events-and-seasonal': Gift,
  'business-and-professional-supplies': Briefcase,
};

export function CategoryIcon({ slug, className, strokeWidth }: { slug: string; className?: string; strokeWidth?: number }) {
  const key = Object.keys(MAP).find((k) => slug === k || slug.startsWith(k + '-'));
  if (slug.includes('footwear') || slug.includes('shoes')) return <Footprints className={className} strokeWidth={strokeWidth} />;
  const Icon = key ? MAP[key] : LayoutGrid;
  return <Icon className={className} strokeWidth={strokeWidth} />;
}

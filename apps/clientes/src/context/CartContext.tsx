"use client";

import { createContext, useContext, useState, useCallback } from "react";

export interface CartItem {
  id: string;
  name: string;
  brand: string;
  variant?: string;
  price: number;
  qty: number;
}

interface CartContextValue {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "qty">, qty?: number) => void;
  removeItem: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  total: number;
  count: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = useCallback((newItem: Omit<CartItem, "qty">, qty = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === newItem.id);
      if (existing) {
        return prev.map((i) => i.id === newItem.id ? { ...i, qty: i.qty + qty } : i);
      }
      return [...prev, { ...newItem, qty }];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQty = useCallback((id: string, qty: number) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, qty } : i));
  }, []);

  const total = items.reduce((acc, i) => acc + i.price * i.qty, 0);
  const count = items.reduce((acc, i) => acc + i.qty, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQty, total, count }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}

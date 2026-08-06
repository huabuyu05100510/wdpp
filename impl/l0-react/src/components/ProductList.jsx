// ProductList.jsx — 产品列表(GET /api/products)
import React from 'react';
import { useAPIData } from '../wdpp.js';

export default function ProductList() {
  const { data: products, loading } = useAPIData('/api/products');

  return (
    <section className="card" data-wdpp-section="GET /api/products">
      <h2>🛒 Products</h2>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul>
          {products?.map((p) => (
            <li key={p.id}>
              {p.name} — ${p.price.toFixed(2)} ({p.stock} in stock)
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

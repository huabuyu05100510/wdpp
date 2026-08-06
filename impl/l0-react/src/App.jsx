// App.jsx — 顶层 React 组件
import React from 'react';
import UserCard from './components/UserCard.jsx';
import OrderList from './components/OrderList.jsx';
import ProductList from './components/ProductList.jsx';
import StatsPanel from './components/StatsPanel.jsx';
import ConditionalDemo from './components/ConditionalDemo.jsx';
import AggregationDemo from './components/AggregationDemo.jsx';

export default function App() {
  return (
    <>
      <header>
        <h1>🌐 WDPP × React — Real Project Demo</h1>
        <p className="subtitle">Hover any element with 📡 to see its source APIs</p>
        <div id="stats">
          <span>📡 APIs: 5</span>
          <span>🔗 React 18 + Vite</span>
          <span>🎯 Component-level provenance</span>
        </div>
      </header>

      <main>
        <UserCard />
        <OrderList />
        <ProductList />
        <StatsPanel />
        <ConditionalDemo />
        <AggregationDemo />
      </main>

      <div id="devtools">
        <h3>🔍 DevTools — Component Provenance</h3>
        <div id="devtools-content">
          Each component renders into its own DOM section marked with <code>data-wdpp-section</code>.
          Hover any element to see which API populated it.
        </div>
      </div>
    </>
  );
}

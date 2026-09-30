import React, { useEffect, useState } from 'react';
import {
  mdiChartBar,
  mdiDownload,
  mdiReceiptTextOutline,
  mdiCashMultiple,
  mdiBasketOutline,
  mdiTrendingUp
} from '@mdi/js';
import type { AuditReport, Snapshot } from '../shared/types';
import { localDate, money } from './helpers';
import { Empty, ErrorText, Field, I, errorMessage } from './ui';

export function Audit({ snapshot }: { snapshot: Snapshot }) {
  const [from, setFrom] = useState(localDate());
  const [to, setTo] = useState(localDate());
  const [sort, setSort] = useState<'quantity' | 'revenue'>('revenue');
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let active = true;
    if (!from || !to || from > to) {
      setError('Choose a start date on or before the end date.');
      setReport(null);
      return;
    }
    setBusy(true);
    setError('');
    window.openpos
      .getAudit(from, to)
      .then((value) => {
        if (active) setReport(value);
      })
      .catch((caught) => {
        if (active) {
          setError(errorMessage(caught));
          setReport(null);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, snapshot.state.revision]);
  const range = (value: 'today' | 'week' | 'month' | 'previous') => {
    const now = new Date(),
      start = new Date(now);
    let end = new Date(now);
    if (value === 'week') start.setDate(start.getDate() - 6);
    if (value === 'month') start.setDate(1);
    if (value === 'previous') {
      start.setDate(1);
      start.setMonth(start.getMonth() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    }
    setFrom(localDate(start));
    setTo(localDate(end));
  };
  const exportReport = async () => {
    setExporting(true);
    setError('');
    try {
      const path = await window.openpos.exportAudit(from, to);
      if (path) setNotice(`Sales report saved to ${path}`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  };
  const currency = snapshot.state.config.currency;
  const fmt = (value: number) => money(value, currency);
  const items = [...(report?.items ?? [])].sort((a, b) => b[sort] - a[sort]);
  const maxGross = Math.max(1, ...(report?.daily.map((day) => day.gross) ?? []));
  return (
    <section className="audit-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE BIG PICTURE</div>
          <h1>Sales at a glance</h1>
          <p>Completed orders, clear insights.</p>
        </div>
        <button
          className="secondary"
          onClick={exportReport}
          disabled={!report || busy || exporting}
        >
          <I path={mdiDownload} size={0.85} />
          {exporting ? 'Exporting…' : 'Export report'}
        </button>
      </div>
      <div className="audit-filters">
        <div className="date-fields">
          <Field label="From">
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="Through">
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
        <div className="button-row">
          {(['today', 'week', 'month', 'previous'] as const).map((value) => (
            <button className="secondary small" key={value} onClick={() => range(value)}>
              {value === 'today'
                ? 'Today'
                : value === 'week'
                  ? 'Last 7 days'
                  : value === 'month'
                    ? 'This month'
                    : 'Last month'}
            </button>
          ))}
        </div>
      </div>
      <ErrorText error={error} />
      {notice && (
        <div className="success-notice" role="status">
          {notice}
        </div>
      )}
      {busy && (
        <p className="muted" role="status">
          Updating sales report…
        </p>
      )}
      {report && (
        <>
          <div className="metric-grid">
            {[
              {
                label: 'Gross sales',
                value: fmt(report.gross),
                description: 'Including tax & fees',
                icon: mdiCashMultiple
              },
              {
                label: 'Completed orders',
                value: report.orderCount.toLocaleString(),
                description: 'Orders in this date range',
                icon: mdiReceiptTextOutline
              },
              {
                label: 'Average order',
                value: fmt(report.averageOrder),
                description: 'Across completed orders',
                icon: mdiBasketOutline
              },
              {
                label: 'Sales before tax',
                value: fmt(report.subtotal + report.fees),
                description: `${fmt(report.tax)} tax collected`,
                icon: mdiTrendingUp
              }
            ].map((metric) => (
              <div className="metric-card" key={metric.label}>
                <div className="metric-label">
                  <span>{metric.label}</span>
                  <I path={metric.icon} size={0.85} />
                </div>
                <strong>{metric.value}</strong>
                <small>{metric.description}</small>
              </div>
            ))}
          </div>
          <div className="audit-chart-panel">
            <div className="section-heading">
              <div>
                <h3>Sales over time</h3>
                <p>Daily gross from completed orders</p>
              </div>
              <span className="legend">
                <span /> Gross sales
              </span>
            </div>
            {report.daily.length ? (
              <div className="chart-container">
                <div
                  className="bar-chart"
                  role="img"
                  aria-label={`Daily gross sales from ${from} through ${to}`}
                >
                  {report.daily.map((day) => (
                    <div key={day.date} className="chart-column">
                      <span className="chart-value">{fmt(day.gross)}</span>
                      <div className="chart-track">
                        <div
                          className="chart-bar"
                          style={{
                            height: `${Math.max(day.gross ? 2 : 0, (day.gross / maxGross) * 100)}%`
                          }}
                          title={`${day.date}: ${fmt(day.gross)}, ${day.orders} orders`}
                        />
                      </div>
                      <span className="chart-date">{day.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Empty
                path={mdiChartBar}
                title="No completed sales yet"
                text="Completed orders in this period will appear here."
              />
            )}
          </div>
          <div className="audit-lower">
            <section className="audit-panel">
              <div className="section-heading">
                <div>
                  <h3>What’s selling</h3>
                  <p>Menu items ranked your way</p>
                </div>
                <select
                  aria-label="Sort items by"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as typeof sort)}
                >
                  <option value="revenue">By revenue</option>
                  <option value="quantity">By quantity</option>
                </select>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Menu item</th>
                      <th className="numeric">Qty</th>
                      <th className="numeric">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={item.id}>
                        <td>
                          <span className="rank">{index + 1}</span>
                          {item.name}
                        </td>
                        <td className="numeric">{item.quantity}</td>
                        <td className="numeric">{fmt(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!items.length && <p className="table-empty">No items sold in this period.</p>}
              </div>
            </section>
            <section className="audit-panel">
              <div className="section-heading">
                <div>
                  <h3>Inventory used</h3>
                  <p>Net order consumption in this period</p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Inventory item</th>
                      <th className="numeric">Consumed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.inventory.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td className="numeric">
                          {item.quantity.toLocaleString()}{' '}
                          <span className="muted">{item.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.inventory.length && (
                  <p className="table-empty">No inventory consumption in this period.</p>
                )}
              </div>
            </section>
          </div>
          <p className="audit-footnote">
            Gross includes fees and collected tax. In-progress and cancelled orders are excluded.
            Dates use this device’s local time.
          </p>
        </>
      )}
    </section>
  );
}

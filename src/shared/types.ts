export type OrderStatus = 'in-progress' | 'completed' | 'cancelled';
export type Fulfillment = 'takeout' | 'delivery' | 'dine-in';
export interface Ingredient {
  inventoryId: string;
  quantity: number;
}
export interface Variant {
  id: string;
  name: string;
  price: number;
  recipe: Ingredient[];
}
export interface MenuItem {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  variants: Variant[];
  recipe: Ingredient[];
  color: string;
  icon: string;
  active: boolean;
  updatedAt: string;
}
export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  lowStockAt: number;
  updatedAt: string;
}
export interface Fee {
  id: string;
  name: string;
  amount: number;
  taxable: boolean;
}
export interface BusinessConfig {
  businessName: string;
  currency: string;
  taxRate: number;
  autoCompleteOrders: boolean;
  inventoryEnabled: boolean;
  fees: Fee[];
  receiptFooter: string;
}
export interface OrderLine {
  id: string;
  menuItemId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  recipe: Ingredient[];
  notes: string;
}
export interface OrderTotals {
  subtotal: number;
  fees: number;
  tax: number;
  total: number;
}
export interface Order {
  id: string;
  number: number;
  status: OrderStatus;
  fulfillment: Fulfillment;
  customerName: string;
  phone: string;
  address: string;
  notes: string;
  lines: OrderLine[];
  fees: Fee[];
  taxRate: number;
  totals: OrderTotals;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  inventoryTracked?: boolean;
  revision: number;
}
export interface InventoryMovement {
  id: string;
  inventoryId: string;
  quantity: number;
  reason: 'restock' | 'order' | 'adjustment' | 'cancel';
  orderId?: string;
  note: string;
  createdAt: string;
}
export interface BusinessState {
  schemaVersion: 1;
  revision: number;
  menu: MenuItem[];
  inventory: InventoryItem[];
  orders: Order[];
  movements: InventoryMovement[];
  config: BusinessConfig;
}
export interface DeviceConfig {
  deviceName: string;
  role: 'standalone' | 'master' | 'client';
  defaultTab: 'menu' | 'orders';
  serverUrl: string;
  port: number;
  syncKey: string;
  clientId: string;
  registeredClients: { id: string; name: string }[];
}
export interface Session {
  isAdmin: boolean;
  passwordSet: boolean;
}
export interface SyncStatus {
  connected: boolean;
  message: string;
  lastSync?: string;
}
export interface Snapshot {
  state: BusinessState;
  device: DeviceConfig;
  session: Session;
  sync: SyncStatus;
  dataPath: string;
  warning?: string;
}
export interface OrderDraft {
  id?: string;
  expectedRevision?: number;
  lines: OrderLine[];
  feeIds: string[];
  fulfillment: Fulfillment;
  customerName: string;
  phone: string;
  address: string;
  notes: string;
}
export type Command =
  | { type: 'start-fresh'; confirmation: string; expectedRevision: number }
  | { type: 'save-menu'; item: MenuItem; expectedRevision?: number }
  | { type: 'save-inventory'; item: InventoryItem; expectedRevision?: number }
  | { type: 'restock'; inventoryId: string; quantity: number; note: string }
  | { type: 'save-config'; config: BusinessConfig; expectedRevision?: number }
  | { type: 'save-order'; draft: OrderDraft }
  | { type: 'complete-order'; id: string; expectedRevision: number }
  | { type: 'cancel-order'; id: string; expectedRevision: number };
export interface AuditRow {
  id: string;
  name: string;
  quantity: number;
  revenue: number;
}
export interface AuditReport {
  orderCount: number;
  subtotal: number;
  fees: number;
  tax: number;
  gross: number;
  averageOrder: number;
  items: AuditRow[];
  inventory: { id: string; name: string; unit: string; quantity: number }[];
  daily: { date: string; gross: number; orders: number }[];
}
export interface OpenPOSAPI {
  getSnapshot(): Promise<Snapshot>;
  execute(command: Command): Promise<Snapshot>;
  unlock(password: string): Promise<Snapshot>;
  lock(): Promise<Snapshot>;
  setPassword(password: string, currentPassword?: string): Promise<Snapshot>;
  saveDevice(device: DeviceConfig): Promise<Snapshot>;
  getAudit(from: string, to: string): Promise<AuditReport>;
  exportAudit(from: string, to: string): Promise<string | null>;
  openHelp(): Promise<void>;
  openDataFolder(): Promise<void>;
  printReceipt(id: string): Promise<void>;
  backup(): Promise<string | null>;
  onChange(listener: (snapshot: Snapshot) => void): () => void;
}
declare global {
  interface Window {
    openpos: OpenPOSAPI;
  }
}

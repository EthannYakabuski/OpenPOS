import type { BusinessState, MenuItem, OrderDraft } from '../shared/types';
import { applyCommand, uid } from './domain';

export function createDemo(now = new Date()): BusinessState {
  const stamp = now.toISOString();
  const inventory = [
    ['dough', 'Pizza dough', 'balls', 75, 15],
    ['cheese', 'Mozzarella', 'kg', 18, 3],
    ['pepperoni', 'Pepperoni', 'kg', 8, 2],
    ['mushroom', 'Mushrooms', 'kg', 5, 1],
    ['wings', 'Chicken wings', 'pieces', 120, 24],
    ['fries', 'Fries', 'portions', 60, 10],
    ['burger', 'Beef burger', 'patties', 36, 8],
    ['pepsi', 'Canned Pepsi', 'cans', 72, 12],
    ['water', 'Bottled water', 'bottles', 48, 8],
    ['snickers', 'Snickers bar', 'bars', 30, 6],
    ['dip', 'Garlic dipping sauce', 'cups', 40, 10]
  ].map(([id, name, unit, quantity, lowStockAt]) => ({
    id: String(id),
    name: String(name),
    unit: String(unit),
    quantity: Number(quantity),
    lowStockAt: Number(lowStockAt),
    updatedAt: stamp
  }));
  const sizes = (base: number, topping?: string) => [
    {
      id: 'small',
      name: 'Small · 10 inch',
      price: base,
      recipe: [
        { inventoryId: 'dough', quantity: 1 },
        { inventoryId: 'cheese', quantity: 0.15 },
        ...(topping ? [{ inventoryId: topping, quantity: 0.07 }] : [])
      ]
    },
    {
      id: 'medium',
      name: 'Medium · 12 inch',
      price: base + 350,
      recipe: [
        { inventoryId: 'dough', quantity: 1 },
        { inventoryId: 'cheese', quantity: 0.22 },
        ...(topping ? [{ inventoryId: topping, quantity: 0.1 }] : [])
      ]
    },
    {
      id: 'large',
      name: 'Large · 16 inch',
      price: base + 650,
      recipe: [
        { inventoryId: 'dough', quantity: 1 },
        { inventoryId: 'cheese', quantity: 0.3 },
        ...(topping ? [{ inventoryId: topping, quantity: 0.14 }] : [])
      ]
    }
  ];
  const simple = (
    id: string,
    name: string,
    category: string,
    price: number,
    stock: string,
    count: number,
    icon: string,
    description: string,
    color: string
  ): MenuItem => ({
    id,
    name,
    category,
    price,
    recipe: [{ inventoryId: stock, quantity: count }],
    variants: [],
    active: true,
    description,
    icon,
    color,
    updatedAt: stamp
  });
  const menu: MenuItem[] = [
    {
      id: 'margherita',
      name: 'Margherita pizza',
      category: 'Pizza',
      description: 'House tomato sauce, mozzarella and fresh basil.',
      price: 1199,
      variants: sizes(1199),
      recipe: [],
      active: true,
      color: '#ef6b47',
      icon: 'pizza',
      updatedAt: stamp
    },
    {
      id: 'pepperoni-pizza',
      name: 'Pepperoni pizza',
      category: 'Pizza',
      description: 'Our classic with generous pepperoni.',
      price: 1399,
      variants: sizes(1399, 'pepperoni'),
      recipe: [],
      active: true,
      color: '#e44f55',
      icon: 'pizza',
      updatedAt: stamp
    },
    {
      id: 'garden-pizza',
      name: 'Garden pizza',
      category: 'Pizza',
      description: 'Mushrooms, mozzarella and house tomato sauce.',
      price: 1399,
      variants: sizes(1399, 'mushroom'),
      recipe: [],
      active: true,
      color: '#519b71',
      icon: 'pizza',
      updatedAt: stamp
    },
    simple(
      'wings-six',
      'Chicken wings · 6',
      'Sides',
      899,
      'wings',
      6,
      'food-drumstick',
      'Six wings, choose your sauce in item notes.',
      '#b97e42'
    ),
    simple(
      'fries-side',
      'Golden fries',
      'Sides',
      449,
      'fries',
      1,
      'french-fries',
      'A generous portion of crisp golden fries.',
      '#cf9c3d'
    ),
    simple(
      'beef-burger',
      'Classic beef burger',
      'Grill',
      899,
      'burger',
      1,
      'hamburger',
      'Beef patty, lettuce, tomato and house sauce.',
      '#b98550'
    ),
    simple(
      'pepsi-can',
      'Canned Pepsi',
      'Drinks',
      225,
      'pepsi',
      1,
      'cup',
      '355 mL can. Chilled and ready to go.',
      '#477bcc'
    ),
    simple(
      'bottled-water',
      'Bottled water',
      'Drinks',
      175,
      'water',
      1,
      'bottle-water',
      '500 mL spring water.',
      '#4b9fae'
    ),
    simple(
      'snickers-bar',
      'Snickers bar',
      'Retail',
      199,
      'snickers',
      1,
      'candy',
      'Peanuts, caramel and milk chocolate.',
      '#926647'
    ),
    simple(
      'garlic-dip',
      'Garlic dipping sauce',
      'Sides',
      125,
      'dip',
      1,
      'bowl-mix',
      'Creamy garlic dip for your pizza crust.',
      '#86845c'
    )
  ];
  let state: BusinessState = {
    schemaVersion: 1,
    revision: 0,
    menu,
    inventory,
    orders: [],
    movements: inventory.map((i) => ({
      id: uid(),
      inventoryId: i.id,
      quantity: i.quantity,
      reason: 'restock',
      note: 'Demo opening stock · owner delivery',
      createdAt: new Date(+now - 32 * 86400000).toISOString()
    })),
    config: {
      businessName: 'Maple & Main Pizza',
      currency: 'CAD',
      taxRate: 13,
      autoCompleteOrders: false,
      inventoryEnabled: true,
      fees: [
        { id: 'delivery', name: 'Delivery', amount: 250, taxable: true },
        { id: 'patio', name: 'Patio service', amount: 150, taxable: true }
      ],
      receiptFooter: 'Thanks for supporting your neighbourhood pizza shop!'
    }
  };
  const examples = [
    {
      ago: 20 * 1440,
      items: [
        ['pepperoni-pizza', 'large', 2],
        ['pepsi-can', undefined, 4]
      ],
      name: 'Jordan',
      complete: true,
      delivery: true
    },
    {
      ago: 7 * 1440,
      items: [
        ['beef-burger', undefined, 2],
        ['fries-side', undefined, 2]
      ],
      name: 'Taylor',
      complete: true
    },
    {
      ago: 1440,
      items: [
        ['garden-pizza', 'medium', 1],
        ['garlic-dip', undefined, 2]
      ],
      name: 'Morgan',
      complete: true
    },
    {
      ago: 110,
      items: [
        ['snickers-bar', undefined, 2],
        ['pepsi-can', undefined, 2]
      ],
      name: 'Walk-in',
      complete: true
    },
    {
      ago: 65,
      items: [
        ['margherita', 'large', 1],
        ['wings-six', undefined, 1]
      ],
      name: 'Sam',
      complete: true
    },
    {
      ago: 18,
      items: [
        ['pepperoni-pizza', 'large', 1],
        ['pepsi-can', undefined, 2],
        ['garlic-dip', undefined, 1]
      ],
      name: 'Alex Rivera',
      complete: false,
      delivery: true
    },
    {
      ago: 7,
      items: [
        ['garden-pizza', 'medium', 1],
        ['fries-side', undefined, 1]
      ],
      name: 'Jamie Chen',
      complete: false
    }
  ];
  for (const e of examples) {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const date = new Date(
      e.complete && e.ago < 1440 ? Math.max(+midnight, +now - e.ago * 60000) : +now - e.ago * 60000
    ).toISOString();
    const draft: OrderDraft = {
      lines: e.items.map(([menuItemId, variantId, qty]) => ({
        id: uid(),
        menuItemId: String(menuItemId),
        ...(variantId ? { variantId: String(variantId) } : {}),
        name: '',
        unitPrice: 0,
        recipe: [],
        notes: '',
        quantity: Number(qty)
      })),
      feeIds: e.delivery ? ['delivery'] : [],
      fulfillment: e.delivery ? 'delivery' : 'takeout',
      customerName: e.name,
      phone: e.delivery ? '416-555-0108' : '',
      address: e.delivery ? '42 Maple Avenue, Unit 2' : '',
      notes: e.delivery ? 'Please ring the doorbell.' : ''
    };
    state = applyCommand(state, { type: 'save-order', draft }, date);
    if (e.complete) {
      const order = state.orders[state.orders.length - 1];
      state = applyCommand(
        state,
        { type: 'complete-order', id: order.id, expectedRevision: order.revision },
        new Date(Math.min(+now, +new Date(date) + 15 * 60000)).toISOString()
      );
    }
  }
  return state;
}

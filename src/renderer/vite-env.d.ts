/// <reference types="vite/client" />

type BarcodeItemPosition =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'above_barcode'
  | 'below_barcode'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'
  | 'hidden';

type BarcodeItemAlign = 'left' | 'center' | 'right';

type BarcodePrintSettings = {
  barcode_label_width_mm: number;
  barcode_label_height_mm: number;
  barcode_copies: number;
  barcode_auto_print_after_save: boolean;

  barcode_name_font_size: number;
  barcode_name_position: BarcodeItemPosition;
  barcode_name_align: BarcodeItemAlign;

  barcode_price_font_size: number;
  barcode_price_position: BarcodeItemPosition;
  barcode_price_align: BarcodeItemAlign;

  barcode_size_font_size: number;
  barcode_size_position: BarcodeItemPosition;
  barcode_size_align: BarcodeItemAlign;

  barcode_color_font_size: number;
  barcode_color_position: BarcodeItemPosition;
  barcode_color_align: BarcodeItemAlign;

  barcode_value_font_size: number;
  barcode_value_position: BarcodeItemPosition;
  barcode_value_align: BarcodeItemAlign;

  barcode_svg_height: number;
};

export {};
declare global {
  interface Window {
    api: {
      // =========================
      // Auth
      // =========================
      login: (data: {
        username: string;
        password: string;
      }) => Promise<{
        success: boolean;
        message?: string;
        user?: {
          id: number;
          name: string;
          username: string;
          role: string;
        };
      }>;

      register: (data: {
        name: string;
        username: string;
        password: string;
        role?: string;
      }) => Promise<{
        success: boolean;
        message?: string;
      }>;

      // =========================
      // Products
      // =========================
      getCategories: () => Promise<any[]>;

      getProducts: (payload?: any) => Promise<any[]>;

      getProductVariants: (payload?: any) => Promise<any[]>;

      toggleVariantActive: (
        variantId: number,
        isActive: boolean | number
      ) => Promise<any>;

      createProduct: (input: any) => Promise<any>;

      updateProduct: (input: any) => Promise<any>;

      updateVariant: (input: any) => Promise<any>;

      toggleProductActive: (
        productId: number,
        isActive: boolean | number
      ) => Promise<any>;

      // =========================
      // Barcode Print Settings
      // =========================
      getBarcodePrintSettings: () => Promise<any>;

      saveBarcodePrintSettings: (input: any) => Promise<any>;

      // =========================
      // Sales
      // =========================
      searchSaleVariants: (query: string) => Promise<any[]>;

      getVariantByBarcode: (barcode: string) => Promise<any | null>;

      createSale: (input: any) => Promise<{
        saleId: number;
        loyalty_points_earned?: number;
        loyalty_points_redeemed?: number;
        loyalty_discount_value?: number;
        grand_total?: number;
      }>;

      // =========================
      // Customers
      // =========================
      getCustomers: () => Promise<Customer[]>;

      searchCustomers: (query: string) => Promise<Customer[]>;

      getCustomerById: (id: number) => Promise<Customer | null>;

      createCustomer: (input: CustomerInput) => Promise<Customer>;

      updateCustomer: (input: CustomerUpdateInput) => Promise<Customer>;

      deleteCustomer: (id: number) => Promise<{ ok: boolean }>;

      getCustomerHistory: (customerId: number) => Promise<CustomerHistory>;

      adjustCustomerPoints: (input: {
        customer_id: number;
        points: number;
        notes?: string | null;
      }) => Promise<Customer>;

      // =========================
      // Loyalty Settings
      // =========================
      getLoyaltySettings: () => Promise<LoyaltySettings>;

      saveLoyaltySettings: (
        input: LoyaltySettings
      ) => Promise<LoyaltySettings>;
    };
  }

  type Customer = {
    id: number;
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
    points_balance: number;
    total_spent: number;
    is_active?: number;
    sales_count?: number;
    last_sale_at?: string | null;
    created_at?: string;
    updated_at?: string;
  };

  type CustomerInput = {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
  };

  type CustomerUpdateInput = CustomerInput & {
    id: number;
    is_active?: number;
  };

  type LoyaltySettings = {
    loyalty_enabled: boolean;
    loyalty_earn_amount: number;
    loyalty_earn_points: number;
    loyalty_point_value: number;
    loyalty_min_redeem_points: number;
  };

  type CustomerHistory = {
    customer: Customer | null;
    sales: Array<{
      id: number;
      sub_total: number;
      discount_value: number;
      grand_total: number;
      paid: number;
      change_amount: number;
      payment_method: string;
      loyalty_points_earned: number;
      loyalty_points_redeemed: number;
      loyalty_discount_value: number;
      created_at: string;
    }>;
    loyalty: Array<{
      id: number;
      customer_id: number;
      sale_id?: number | null;
      type: 'earn' | 'redeem' | 'adjust';
      points: number;
      amount: number;
      notes?: string | null;
      created_at: string;
    }>;
  };
} 
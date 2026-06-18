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

  barcode_content_offset_x_mm: number;
  barcode_content_offset_y_mm: number;

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
    
    __APP_LICENSE_STATUS__?: {
      activated: boolean;
      trial_started_at: string;
      trial_days: number;
      trial_expires_at: string;
      days_left: number;
      expired: boolean;
      blocked?: boolean;
      message?: string;
      device_code?: string;
      app_logo_url: string;
      app_name: string;
      app_theme?: 'dark' | 'light';
      store_phone?: string;
      store_address?: string;
    };

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

      getUsers: (input?: {
        search?: string;
        actor_id?: number;
      }) => Promise<{
        success: boolean;
        message?: string;
        users: SystemUser[];
      }>;

      createSystemUser: (input: {
        name: string;
        username: string;
        password: string;
        role: 'admin' | 'cashier';
        actor_id?: number;
      }) => Promise<MutationResult<SystemUser>>;

      updateSystemUser: (input: {
        id: number;
        name: string;
        username: string;
        role: 'admin' | 'cashier';
        is_active: number;
        actor_id?: number;
      }) => Promise<MutationResult<SystemUser>>;

      setUserActive: (
        userId: number,
        isActive: number,
        actorId?: number
      ) => Promise<MutationResult<SystemUser>>;

      resetUserPassword: (
        userId: number,
        password: string,
        actorId?: number
      ) => Promise<MutationResult<SystemUser>>;

      // =========================
      // Products
      // =========================
      getCategories: () => Promise<any[]>;

      getProducts: (payload?: any) => Promise<any[]>;

      getProductVariants: (payload?: any) => Promise<any[]>;

      toggleVariantActive: (
        variantId: number,
        isActive: boolean | number,
        actorId?: number
      ) => Promise<any>;

      createProduct: (input: any) => Promise<any>;

      updateProduct: (input: any) => Promise<any>;

      updateVariant: (input: any) => Promise<any>;

      toggleProductActive: (
        productId: number,
        isActive: boolean | number,
        actorId?: number
      ) => Promise<any>;

      addProductVariant: (input: {
        product_id: number;
        barcode: string;
        size: string;
        color: string;
        buy_price: number;
        sell_price: number;
        min_stock: number;
        opening_qty?: number;
        actor_id?: number;
      }) => Promise<{
        success: boolean;
        variantId?: number;
        message?: string;
      }>;

      // =========================
      // Barcode Print Settings
      // =========================
      getBarcodePrintSettings: () => Promise<any>;

      saveBarcodePrintSettings: (input: any) => Promise<any>;

      // =========================
      // Sales
      // =========================
      searchSaleVariants: (query: string) => Promise<any[]>;
      getSaleReturnHistory: (saleId: number) => Promise<any[]>;

      getVariantByBarcode: (barcode: string) => Promise<any | null>;

      createSale: (input: any) => Promise<{
        saleId: number;
        loyalty_points_earned?: number;
        loyalty_points_redeemed?: number;
        loyalty_discount_value?: number;
        grand_total?: number;
      }>;

      getSaleReceipt: (saleId: number) => Promise<{
        sale: any;
        items: any[];
        loyalty: any[];
      }>;

      listSales: (input?: {
        search?: string;
        date_from?: string;
        date_to?: string;
        limit?: number;
        offset?: number;
      }) => Promise<{
        rows: Array<{
          id: number;
          customer_id: number | null;
          user_id: number | null;
          sub_total: number;
          discount_value: number;
          grand_total: number;
          paid: number;
          remaining_amount: number;
          payment_status: string;
          change_amount: number;
          payment_method: string;
          notes?: string | null;
          loyalty_points_earned: number;
          loyalty_points_redeemed: number;
          loyalty_discount_value: number;
          created_at: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          cashier_name?: string | null;
          items_count: number;
          total_quantity: number;
          returned_quantity: number;
          return_count: number;
          total_return_amount: number;
        }>;
        total: number;
        limit: number;
        offset: number;
      }>;

      createSaleReturn: (input: {
        original_sale_id: number;
        user_id: number;
        reason?: string | null;
        refund_payment_method?: string | null;
        items: Array<{
          sale_item_id: number;
          variant_id: number;
          quantity: number;
        }>;
      }) => Promise<{
        returnId?: number;
        returnCode?: string;
        returnSaleId: number;
        originalSaleId: number;
        refundAmount: number;
        loyalty_points_reversed: number;
      }>;

      listSaleReturns: (input?: {
        search?: string;
        date_from?: string;
        date_to?: string;
        limit?: number;
        offset?: number;
      }) => Promise<{
        rows: Array<{
          id: number;
          code: string;
          original_sale_id: number;
          customer_name?: string | null;
          customer_phone?: string | null;
          cashier_name?: string | null;
          sub_total: number;
          loyalty_discount_value: number;
          refund_amount: number;
          payment_method: string;
          reason?: string | null;
          loyalty_points_reversed: number;
          created_at: string;
          items_count: number;
          total_quantity: number;
        }>;
        total: number;
        limit: number;
        offset: number;
      }>;

      // =========================
      // Customers
      // =========================
      getCustomers: () => Promise<Customer[]>;

      searchCustomers: (query: string) => Promise<Customer[]>;

      getCustomerById: (id: number) => Promise<Customer | null>;

      createCustomer: (input: CustomerInput) => Promise<Customer>;

      updateCustomer: (input: CustomerUpdateInput) => Promise<Customer>;

      deleteCustomer: (id: number, actorId?: number) => Promise<{ ok: boolean }>;

      getCustomerHistory: (customerId: number) => Promise<CustomerHistory>;

      adjustCustomerPoints: (input: {
        customer_id: number;
        points: number;
        notes?: string | null;
        actor_id?: number;
      }) => Promise<Customer>;

      recordCustomerPayment: (input: {
        customer_id: number;
        sale_id?: number | null;
        amount: number;
        payment_method?: string;
        notes?: string | null;
        actor_id?: number;
      }) => Promise<{
        ok: boolean;
        customer_id: number;
        paid_amount: number;
        allocations?: Array<{
          sale_id: number | null;
          amount: number;
        }>;
      }>;

      getCustomerStatement: (customerId: number) => Promise<{
        customer: any;
        sales: any[];
        payments: any[];
        entries: Array<{
          id: string;
          type: 'sale' | 'payment';
          title: string;
          debit: number;
          credit: number;
          sale_id?: number | null;
          payment_status?: string;
          payment_method?: string;
          notes?: string | null;
          created_at: string;
        }>;
        summary: {
          total_sales: number;
          total_paid: number;
          balance: number;
          open_sales: number;
        };
      }>;


      // =========================
      // Loyalty Settings
      // =========================
      getLoyaltySettings: () => Promise<LoyaltySettings>;

      saveLoyaltySettings: (
        input: LoyaltySettings
      ) => Promise<LoyaltySettings>;

      //==========================
      //Backups
      //==========================
      backupDatabase: (input?: { actor_id?: number }) => Promise<{
        success: boolean;
        canceled?: boolean;
        path?: string;
        message?: string;
      }>;

      restoreDatabase: (input?: { actor_id?: number }) => Promise<{
        success: boolean;
        canceled?: boolean;
        path?: string;
        safetyBackupPath?: string;
        message?: string;
      }>;

      resetDatabase: (input?: { actor_id?: number }) => Promise<{
        success: boolean;
        canceled?: boolean;
        message?: string;
        safetyBackupPath?: string;
      }>;

      // =========================
      // Logs
      // =========================
      getActivityLogs: (input?: {
        search?: string;
        limit?: number;
      }) => Promise<ActivityLog[]>;

      // =========================
      // Reports
      // =========================
      getReportsSummary: (input?: {
        date_from?: string;
        date_to?: string;
      }) => Promise<{
        summary: {
          sales_count: number;
          returns_count: number;
          gross_sales: number;
          total_returns: number;
          normal_discounts: number;
          loyalty_discounts: number;
          total_discounts: number;
          net_sales: number;
          gross_profit_before_discounts: number;
          net_profit_after_discounts: number;
          total_expenses: number;
          total_liability_payments: number;
          final_net_profit: number;
        };
        cashAccounts: Array<{
          payment_method: string;
          label: string;
          total_in: number;
          total_out: number;
          balance: number;
        }>;

        cashTotalCapital: number;
        topProducts: Array<any>;
        dailySales: Array<any>;
        paymentMethods: Array<any>;
        lowStock: Array<any>;
        topCustomers: Array<any>;
      }>;

      // =========================
      // Inventory
      // =========================
        getInventoryList: (input?: {
          search?: string;
          status?: 'all' | 'available' | 'low' | 'out' | 'negative';
        }) => Promise<
          Array<{
            variant_id: number;
            product_id: number;
            product_name: string;
            barcode?: string | null;
            size?: string | null;
            color?: string | null;
            buy_price: number;
            sell_price: number;
            min_stock: number;
            is_active: number;
            product_is_active: number;
            stock: number;
          }>
        >;

        adjustVariantStock: (input: {
          variant_id: number;
          target_stock: number;
          notes?: string | null;
          actor_id?: number;
        }) => Promise<{
          success: boolean;
          variant_id: number;
          old_stock: number;
          new_stock: number;
          diff: number;
        }>;

        getStockMovements: (input: {
          variant_id?: number;
          search?: string;
          limit?: number;
        }) => Promise<
          Array<{
            id: number;
            variant_id: number;
            type: 'in' | 'out';
            quantity: number;
            signed_quantity: number;
            reference_id?: number | null;
            reference_type?: string | null;
            notes?: string | null;
            created_at: string;
            product_name: string;
            barcode?: string | null;
            size?: string | null;
            color?: string | null;
          }>
        >;

        getStockCountSessions: () => Promise<any[]>;

        getStockCountSession: (sessionId: number) => Promise<{
          session: any;
          items: any[];
        }>;

        createStockCountSession: (input: {
          title: string;
          notes?: string | null;
          actor_id?: number;
        }) => Promise<any>;

        updateStockCountItem: (input: {
          session_id: number;
          item_id: number;
          actual_stock: number;
          notes?: string | null;
        }) => Promise<any>;

        scanStockCountBarcode: (input: {
          session_id: number;
          barcode: string;
          quantity?: number;
        }) => Promise<any>;

        approveStockCountSession: (input: {
          session_id: number;
          actor_id?: number;
        }) => Promise<any>;

        cancelStockCountSession: (input: {
          session_id: number;
          actor_id?: number;
        }) => Promise<any>;

        savePdfFromHtml: (input: {
          html: string;
          defaultFileName?: string;
          landscape?: boolean;
        }) => Promise<{
          ok: boolean;
          canceled?: boolean;
          filePath?: string;
        }>;

        
        // =========================
        // Suppliers
        // =========================
          getSuppliers: (search?: string) => Promise<
            Array<{
              id: number;
              name: string;
              phone?: string | null;
              email?: string | null;
              address?: string | null;
              notes?: string | null;
              total_purchased: number;
              balance: number;
              is_active: number;
              created_at: string;
              updated_at?: string | null;
            }>
          >;

          getSupplierById: (id: number) => Promise<any>;

          createSupplier: (input: {
            name: string;
            phone?: string | null;
            email?: string | null;
            address?: string | null;
            notes?: string | null;
            actor_id?: number;
          }) => Promise<any>;

          updateSupplier: (input: {
            id: number;
            name: string;
            phone?: string | null;
            email?: string | null;
            address?: string | null;
            notes?: string | null;
            actor_id?: number;
          }) => Promise<any>;

          deleteSupplier: (id: number, actorId?: number) => Promise<{ ok: boolean }>;

        // =========================
        // Purchases
        // =========================
        createPurchaseInvoice: (input: {
          supplier_id: number;
          sub_total?: number;
          discount_type?: 'amount' | 'percent' | string;
          discount_input?: number;
          discount_value?: number;
          paid_amount?: number;
          payment_method?: string;
          notes?: string | null;
          actor_id?: number;
          items: Array<{
            variant_id: number;
            quantity: number;
            unit_cost: number;
          }>;
        }) => Promise<{
          purchaseId: number;
          total_amount: number;
          paid_amount: number;
          remaining_amount: number;
          payment_status: string;
        }>;

        listPurchaseInvoices: (input?: {
          search?: string;
          limit?: number;
          offset?: number;
        }) => Promise<{
          rows: any[];
          total: number;
          limit: number;
          offset: number;
        }>;

        getPurchaseInvoice: (purchaseId: number) => Promise<{
          purchase: any;
          items: Array<{
            id: number;
            purchase_id: number;
            variant_id: number;
            product_name: string;
            barcode?: string | null;
            size?: string | null;
            color?: string | null;
            quantity: number;
            unit_cost: number;
            line_total: number;
            returned_quantity?: number;
            returnable_quantity?: number;
          }>;
          payments: any[];
          returns?: any[];
        }>;

        cancelPurchaseInvoice: (input: {
          purchase_id: number;
          reason?: string;
          actor_id?: number;
        }) => Promise<{
          ok: boolean;
          purchase_id: number;
          supplier_id: number;
          reversed_total: number;
          reversed_paid: number;
          reversed_remaining: number;
          items_count: number;
        }>;

        createPurchaseReturn: (input: {
          purchase_id: number;
          notes?: string | null;
          actor_id?: number;
          refund_payment_method?: string | null;
          refund_mode?: 'cash' | 'credit' | string;
          items: Array<{
            purchase_item_id?: number;
            variant_id?: number;
            quantity: number;
          }>;
        }) => Promise<{
          ok: boolean;
          return_id: number;
          purchase_id: number;
          supplier_id: number;
          total_amount: number;
          items_count: number;
          debt_reduction_amount?: number;
          cash_refund_amount?: number;
          refund_mode?: string;
          refund_payment_method?: string | null;
        }>;

        listPurchaseReturns: (input?: {
          search?: string;
          limit?: number;
          offset?: number;
        }) => Promise<{
          rows: any[];
          total: number;
          limit: number;
          offset: number;
        }>;

        getPurchaseReturn: (returnId: number) => Promise<{
          return: any;
          items: any[];
        }>;

        recordSupplierPayment: (input: {
          supplier_id: number;
          purchase_id?: number | null;
          amount: number;
          payment_method?: string;
          notes?: string | null;
          actor_id?: number;
        }) => Promise<{
          ok: boolean;
          supplier_id: number;
          paid_amount: number;
          allocations?: Array<{
            purchase_id: number | null;
            amount: number;
          }>;
        }>;

        getSupplierStatement: (supplierId: number) => Promise<{
          supplier: any;
          purchases: any[];
          payments: any[];
          returns?: any[];
          entries: Array<{
            id: string;
            type: 'purchase' | 'payment' | 'purchase_return';
            title: string;
            debit: number;
            credit: number;
            purchase_id?: number | null;
            return_id?: number;
            payment_status?: string;
            payment_method?: string;
            notes?: string | null;
            created_at: string;
          }>;
          summary: {
            total_purchased: number;
            total_paid: number;
            total_returns?: number;
            balance: number;
            open_purchases: number;
          };
        }>;


        // =========================
        // Cash Movements
        // =========================
        
          getCashSummary: (input?: {
            date_from?: string;
            date_to?: string;
            type?: string;
            direction?: 'all' | 'in' | 'out';
            payment_method?: string;
            search?: string;
          }) => Promise<{
            total_in: number;
            total_out: number;
            balance: number;
            movements_count: number;
          }>;

          getCashMovements: (input?: {
            date_from?: string;
            date_to?: string;
            type?: string;
            direction?: 'all' | 'in' | 'out';
            payment_method?: string;
            search?: string;
          }) => Promise<any[]>;

          createCashMovement: (input: any) => Promise<any>;
          createCashTransfer: (input: any) => Promise<any>;
        

        // =========================
        // Expenses
        // =========================
          getExpenses: () => Promise<any[]>;
          createExpense: (input: any) => Promise<any>;
          
        // =========================
        // Activation Code
        // =========================
        getLicenseStatus: () => Promise<{
          activated: boolean;
          trial_started_at: string;
          trial_days: number;
          trial_expires_at: string;
          days_left: number;
          expired: boolean;
          blocked?: boolean;
          message?: string;
          device_code: string;
          app_logo_url: string;
          app_name: string;
          app_theme: 'dark' | 'light';
          store_phone: string;
          store_address: string;
        }>;

        activateApp: (code: string) => Promise<{
          success: boolean;
          message?: string;
          status?: {
            activated: boolean;
            trial_started_at: string;
            trial_days: number;
            trial_expires_at: string;
            days_left: number;
            expired: boolean;
            blocked?: boolean;
            message?: string;
            device_code: string;
            app_logo_url: string;
            app_name: string;
            app_theme: 'dark' | 'light';
          };
        }>;

        saveAppLogoUrl: (url: string, input?: { actor_id?: number }) => Promise<{
          success: boolean;
          status: {
            activated: boolean;
            trial_started_at: string;
            trial_days: number;
            trial_expires_at: string;
            days_left: number;
            expired: boolean;
            blocked?: boolean;
            message?: string;
            device_code: string;
            app_logo_url: string;
            app_name: string;
            app_theme: 'dark' | 'light';
          };
        }>;
       
        chooseAppLogo: (input?: { actor_id?: number }) => Promise<{
          success: boolean;
          canceled?: boolean;
          logoUrl?: string;
          message?: string;
          status?: {
            activated: boolean;
            trial_started_at: string;
            trial_days: number;
            trial_expires_at: string;
            days_left: number;
            expired: boolean;
            blocked?: boolean;
            message?: string;
            device_code: string;
            app_logo_url: string;
            app_name: string;
            app_theme: 'dark' | 'light';
          };
        }>;

        deactivateApp: () => Promise<{
          success: boolean;
          message?: string;
          status?: {
            activated: boolean;
            trial_started_at: string;
            trial_days: number;
            trial_expires_at: string;
            days_left: number;
            expired: boolean;
            blocked?: boolean;
            message?: string;
            device_code: string;
            app_logo_url: string;
            app_name: string;
            app_theme: 'dark' | 'light';
          };
        }>;

        saveAppName: (name: string, input?: { actor_id?: number }) => Promise<{
          success: boolean;
          status: {
            activated: boolean;
            trial_started_at: string;
            trial_days: number;
            trial_expires_at: string;
            days_left: number;
            expired: boolean;
            blocked?: boolean;
            message?: string;
            device_code: string;
            app_logo_url: string;
            app_name: string;
            app_theme: 'dark' | 'light';
          };
        }>;

        saveAppTheme: (
          theme: 'dark' | 'light',
          input?: { actor_id?: number }
        ) => Promise<{
          success: boolean;
          message?: string;
          status: {
            activated: boolean;
            trial_started_at: string;
            trial_days: number;
            trial_expires_at: string;
            days_left: number;
            expired: boolean;
            blocked?: boolean;
            message?: string;
            device_code: string;
            app_logo_url: string;
            app_name: string;
            app_theme: 'dark' | 'light';
          };
        }>;

        saveStoreContactInfo: (
          phone: string,
          address: string,
          input: any
        ) => Promise<any>;


        // =========================
        // Liabilities
        // ==========================
        getLiabilities: (input?: { search?: string; status?: string }) => Promise<any[]>;
        createLiability: (input: any) => Promise<any>;
        recordLiabilityPayment: (input: any) => Promise<any>;
        getLiabilityStatement: (liabilityId: number) => Promise<any>;
        cancelLiability: (input: any) => Promise<any>;
        getLiabilitiesSummary: (input?: { date_from?: string; date_to?: string }) => Promise<any>;
        
    
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

  type SystemUser = {
    id: number;
    name: string;
    username: string;
    role: 'admin' | 'cashier' | string;
    is_active: number;
    created_at: string;
  };

  type MutationResult<T = any> = {
    success: boolean;
    message?: string;
    user?: T;
  };

  type ActivityLog = {
    id: number;
    user_id?: number | null;
    action: string;
    entity?: string | null;
    entity_id?: number | null;
    details?: string | null;
    created_at: string;
    user_name?: string | null;
    username?: string | null;
  };

} 
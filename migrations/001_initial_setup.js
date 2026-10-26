export const up = async (pgm) => {
  // Create enums
  pgm.createType('app_role', ['alumno', 'profesor', 'admin']);
  pgm.createType('sub_status', ['active', 'pending_cash', 'past_due', 'cancelled', 'grace_period', 'incomplete']);
  pgm.createType('booking_status', ['confirmed', 'waitlisted', 'cancelled']);
  pgm.createType('session_status', ['scheduled', 'cancelled', 'completed']);
  pgm.createType('attendance_status', ['present', 'absent']);
  pgm.createType('attendance_method', ['manual', 'qr']);
  pgm.createType('payment_method', ['stripe', 'cash']);
  pgm.createType('event_payment_status', ['free', 'pending', 'paid', 'cash']);

  // user_roles table
  pgm.createTable('user_roles', {
    id: { type: 'bigint', primaryKey: true, notNull: true },
    user_id: { type: 'uuid', notNull: true },
    role: { type: 'app_role', notNull: true }
  });
  
  // Create index on user_id for user_roles
  pgm.createIndex('user_roles', 'user_id');

  // profiles table
  pgm.createTable('profiles', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    display_name: { type: 'text' },
    phone: { type: 'text' },
    avatar_url: { type: 'text' },
    bio: { type: 'text' },
    social_links: { type: 'jsonb' },
    is_public: { type: 'boolean', default: false },
    visible_fields: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  // Create index on is_public for profiles
  pgm.createIndex('profiles', 'is_public', { where: 'is_public = true' });

  // user_mfa table
  pgm.createTable('user_mfa', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    user_id: { type: 'uuid', notNull: true, unique: true },
    totp_secret_encrypted: { type: 'text' },
    recovery_codes_encrypted: { type: 'text' },
    mfa_enabled: { type: 'boolean', default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  // Create index on user_id for user_mfa
  pgm.createIndex('user_mfa', 'user_id');

  // disciplines table
  pgm.createTable('disciplines', {
    id: { type: 'bigint', primaryKey: true, notNull: true },
    name: { type: 'text', notNull: true, unique: true },
    is_active: { type: 'boolean' }
  });

  // plans table
  pgm.createTable('plans', {
    id: { type: 'bigint', primaryKey: true, notNull: true },
    name: { type: 'text', notNull: true },
    price_cents: { type: 'integer' },
    billing_period: { type: 'text' },
    is_active: { type: 'boolean' }
  });

  // plan_disciplines table (junction table)
  pgm.createTable('plan_disciplines', {
    plan_id: { type: 'bigint', notNull: true },
    discipline_id: { type: 'bigint', notNull: true }
  });

  // Create primary key for plan_disciplines
  pgm.addConstraint('plan_disciplines', 'plan_disciplines_pkey', {
    primaryKey: ['plan_id', 'discipline_id']
  });

  // subscriptions table
  pgm.createTable('subscriptions', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    student_id: { type: 'uuid', notNull: true },
    plan_id: { type: 'bigint', notNull: true },
    status: { type: 'sub_status', notNull: true },
    payment_method: { type: 'payment_method', default: 'stripe' },
    current_period_start: { type: 'timestamptz' },
    current_period_end: { type: 'timestamptz' },
    cancel_at_period_end: { type: 'boolean', default: false },
    cancelled_at: { type: 'timestamptz' },
    stripe_subscription_id: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  // Create indexes for subscriptions
  pgm.createIndex('subscriptions', 'student_id');
  pgm.createIndex('subscriptions', 'status');
  pgm.createIndex('subscriptions', 'stripe_subscription_id');

  // subscription_agreements table
  pgm.createTable('subscription_agreements', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    student_id: { type: 'uuid', notNull: true },
    insurance_type: { type: 'text' },
    waiver_version: { type: 'text' },
    accepted_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    accepted_ip: { type: 'text' }
  });

  // Create index for subscription_agreements
  pgm.createIndex('subscription_agreements', 'student_id');

  // cash_payments table (created empty, reserved for future)
  pgm.createTable('cash_payments', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    subscription_id: { type: 'uuid' },
    student_id: { type: 'uuid' },
    admin_id: { type: 'uuid' },
    amount_cents: { type: 'integer' },
    period_start: { type: 'date' },
    period_end: { type: 'date' },
    received_at: { type: 'timestamptz' },
    notes: { type: 'text' }
  });

  // invoices table
  pgm.createTable('invoices', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    student_id: { type: 'uuid', notNull: true },
    subscription_id: { type: 'uuid' },
    stripe_invoice_id: { type: 'text', unique: true },
    external_pdf_url: { type: 'text' },
    amount_due_cents: { type: 'integer' },
    paid_cents: { type: 'integer' },
    status: { type: 'text' },
    paid_at: { type: 'timestamptz' }
  });

  // Create indexes for invoices
  pgm.createIndex('invoices', 'student_id');
  pgm.createIndex('invoices', 'stripe_invoice_id');

  // class_sessions table
  pgm.createTable('class_sessions', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    discipline_id: { type: 'bigint', notNull: true },
    trainer_id: { type: 'uuid', notNull: true },
    starts_at: { type: 'timestamptz', notNull: true },
    duration_min: { type: 'integer' },
    capacity: { type: 'integer' },
    location: { type: 'text' },
    status: { type: 'session_status', notNull: true }
  });

  // Create indexes for class_sessions
  pgm.createIndex('class_sessions', 'starts_at');
  pgm.createIndex('class_sessions', ['trainer_id', 'starts_at']);
  pgm.createIndex('class_sessions', ['discipline_id', 'starts_at']);

  // bookings table
  pgm.createTable('bookings', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    session_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    status: { type: 'booking_status', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  // Create unique constraint for bookings
  pgm.addConstraint('bookings', 'bookings_unique_active_booking', {
    unique: ['session_id', 'student_id'],
    where: "status != 'cancelled'"
  });

  // Create indexes for bookings
  pgm.createIndex('bookings', ['student_id', 'created_at'], { sort: 'DESC' });
  pgm.createIndex('bookings', ['session_id', 'status']);

  // attendance table
  pgm.createTable('attendance', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    session_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    status: { type: 'attendance_status', notNull: true },
    method: { type: 'attendance_method', notNull: true },
    recorded_by: { type: 'uuid' },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    corrected_at: { type: 'timestamptz' },
    correction_reason: { type: 'text' }
  });

  // Create unique constraint for attendance
  pgm.addConstraint('attendance', 'attendance_session_id_student_id_key', {
    unique: ['session_id', 'student_id']
  });

  // Create indexes for attendance
  pgm.createIndex('attendance', ['student_id', 'recorded_at'], { sort: 'DESC' });
  pgm.createIndex('attendance', 'session_id');

  // events table
  pgm.createTable('events', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    title: { type: 'text', notNull: true },
    description: { type: 'text' },
    starts_at: { type: 'timestamptz', notNull: true },
    ends_at: { type: 'timestamptz', notNull: true },
    capacity: { type: 'integer' },
    price_cents: { type: 'integer' },
    location: { type: 'text' }
  });

  // event_registrations table
  pgm.createTable('event_registrations', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    event_id: { type: 'uuid', notNull: true },
    student_id: { type: 'uuid', notNull: true },
    payment_status: { type: 'event_payment_status', notNull: true }
  });

  // Create indexes for event_registrations
  pgm.createIndex('event_registrations', 'event_id');
  pgm.createIndex('event_registrations', 'student_id');

  // activity_feed table
  pgm.createTable('activity_feed', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    student_id: { type: 'uuid', notNull: true },
    activity_type: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true },
    shared_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  // Create index for activity_feed
  pgm.createIndex('activity_feed', ['student_id', 'shared_at'], { sort: 'DESC' });

  // webhook_events table
  pgm.createTable('webhook_events', {
    id: { type: 'text', primaryKey: true, notNull: true },
    type: { type: 'text', notNull: true },
    processed_at: { type: 'timestamptz' },
    payload: { type: 'jsonb', notNull: true }
  });

  // academy_settings table
  pgm.createTable('academy_settings', {
    key: { type: 'text', primaryKey: true, notNull: true },
    value: { type: 'jsonb', notNull: true }
  });

  // audit_log table
  pgm.createTable('audit_log', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    actor_id: { type: 'uuid', notNull: true },
    action: { type: 'text', notNull: true },
    resource_type: { type: 'text', notNull: true },
    resource_id: { type: 'text', notNull: true },
    changes: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  // Create indexes for audit_log
  pgm.createIndex('audit_log', ['actor_id', 'created_at'], { sort: 'DESC' });
  pgm.createIndex('audit_log', ['resource_type', 'resource_id']);

  // student_stats_daily table (aggregation)
  pgm.createTable('student_stats_daily', {
    student_id: { type: 'uuid', notNull: true },
    date: { type: 'date', notNull: true },
    classes_attended: { type: 'integer' },
    streak_weeks: { type: 'integer' }
  });

  // Create primary key for student_stats_daily
  pgm.addConstraint('student_stats_daily', 'student_stats_daily_pkey', {
    primaryKey: ['student_id', 'date']
  });

  // academy_stats_daily table (aggregation)
  pgm.createTable('academy_stats_daily', {
    date: { type: 'date', primaryKey: true, notNull: true },
    active_students: { type: 'integer' },
    new_students: { type: 'integer' },
    cancelled_students: { type: 'integer' },
    mrr_cents: { type: 'integer' },
    occupancy_rate: { type: 'numeric' }
  });

  // push_subscriptions table
  pgm.createTable('push_subscriptions', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    user_id: { type: 'uuid', notNull: true },
    endpoint: { type: 'text', notNull: true },
    keys: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  // Create index for push_subscriptions
  pgm.createIndex('push_subscriptions', 'user_id');

  // Add foreign key constraints

  pgm.addConstraint('subscriptions', 'subscriptions_student_id_fkey', {
    foreignKeys: [{
      columns: 'student_id',
      references: 'profiles(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('subscriptions', 'subscriptions_plan_id_fkey', {
    foreignKeys: [{
      columns: 'plan_id',
      references: 'plans(id)',
      onDelete: 'RESTRICT'
    }]
  });

  pgm.addConstraint('subscription_agreements', 'subscription_agreements_student_id_fkey', {
    foreignKeys: [{
      columns: 'student_id',
      references: 'profiles(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('cash_payments', 'cash_payments_subscription_id_fkey', {
    foreignKeys: [{
      columns: 'subscription_id',
      references: 'subscriptions(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('cash_payments', 'cash_payments_student_id_fkey', {
    foreignKeys: [{
      columns: 'student_id',
      references: 'profiles(id)',
      onDelete: 'RESTRICT'
    }]
  });

  pgm.addConstraint('cash_payments', 'cash_payments_admin_id_fkey', {
    foreignKeys: [{
      columns: 'admin_id',
      references: 'profiles(id)',
      onDelete: 'RESTRICT'
    }]
  });

  pgm.addConstraint('invoices', 'invoices_student_id_fkey', {
    foreignKeys: [{
      columns: 'student_id',
      references: 'profiles(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('invoices', 'invoices_subscription_id_fkey', {
    foreignKeys: [{
      columns: 'subscription_id',
      references: 'subscriptions(id)',
      onDelete: 'SET NULL'
    }]
  });

  pgm.addConstraint('class_sessions', 'class_sessions_discipline_id_fkey', {
    foreignKeys: [{
      columns: 'discipline_id',
      references: 'disciplines(id)',
      onDelete: 'RESTRICT'
    }]
  });

  pgm.addConstraint('class_sessions', 'class_sessions_trainer_id_fkey', {
    foreignKeys: [{
      columns: 'trainer_id',
      references: 'profiles(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('bookings', 'bookings_session_id_fkey', {
    foreignKeys: [{
      columns: 'session_id',
      references: 'class_sessions(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('bookings', 'bookings_student_id_fkey', {
    foreignKeys: [{
      columns: 'student_id',
      references: 'profiles(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('attendance', 'attendance_session_id_fkey', {
    foreignKeys: [{
      columns: 'session_id',
      references: 'class_sessions(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('attendance', 'attendance_student_id_fkey', {
    foreignKeys: [{
      columns: 'student_id',
      references: 'profiles(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('attendance', 'attendance_recorded_by_fkey', {
    foreignKeys: [{
      columns: 'recorded_by',
      references: 'profiles(id)',
      onDelete: 'SET NULL'
    }]
  });

  pgm.addConstraint('events', 'events_id_fkey', {
    foreignKeys: [{
      columns: 'id',
      references: 'class_sessions(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('event_registrations', 'event_registrations_event_id_fkey', {
    foreignKeys: [{
      columns: 'event_id',
      references: 'events(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('event_registrations', 'event_registrations_student_id_fkey', {
    foreignKeys: [{
      columns: 'student_id',
      references: 'profiles(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('activity_feed', 'activity_feed_student_id_fkey', {
    foreignKeys: [{
      columns: 'student_id',
      references: 'profiles(id)',
      onDelete: 'CASCADE'
    }]
  });

  pgm.addConstraint('audit_log', 'audit_log_actor_id_fkey', {
    foreignKeys: [{
      columns: 'actor_id',
      references: 'profiles(id)',
      onDelete: 'RESTRICT'
    }]
  });

  pgm.addConstraint('student_stats_daily', 'student_stats_daily_student_id_fkey', {
    foreignKeys: [{
      columns: 'student_id',
      references: 'profiles(id)',
      onDelete: 'CASCADE'
    }]
  });
};

export const down = async (pgm) => {
  // Drop tables in reverse order
  pgm.dropTable('push_subscriptions');
  pgm.dropTable('student_stats_daily');
  pgm.dropTable('academy_stats_daily');
  pgm.dropTable('audit_log');
  pgm.dropTable('academy_settings');
  pgm.dropTable('webhook_events');
  pgm.dropTable('activity_feed');
  pgm.dropTable('event_registrations');
  pgm.dropTable('events');
  pgm.dropTable('attendance');
  pgm.dropTable('bookings');
  pgm.dropTable('class_sessions');
  pgm.dropTable('invoices');
  pgm.dropTable('cash_payments');
  pgm.dropTable('subscription_agreements');
  pgm.dropTable('subscriptions');
  pgm.dropTable('plan_disciplines');
  pgm.dropTable('plans');
  pgm.dropTable('disciplines');
  pgm.dropTable('user_mfa');
  pgm.dropTable('profiles');
  pgm.dropTable('user_roles');

  // Drop enums
  pgm.dropType('app_role');
  pgm.dropType('sub_status');
  pgm.dropType('booking_status');
  pgm.dropType('session_status');
  pgm.dropType('attendance_status');
  pgm.dropType('attendance_method');
  pgm.dropType('payment_method');
  pgm.dropType('event_payment_status');
};
-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "pincode" TEXT NOT NULL DEFAULT '',
    "mobile" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "contact_person" TEXT NOT NULL DEFAULT '',
    "plan_type" TEXT NOT NULL DEFAULT 'YEARLY',
    "plan_amount" INTEGER NOT NULL DEFAULT 0,
    "plan_start" DATE,
    "plan_end" DATE,
    "disabled_menus" JSONB,
    "fee_due_day" INTEGER NOT NULL DEFAULT 10,
    "late_fee_amount" INTEGER NOT NULL DEFAULT 0,
    "late_fee_from" DATE,
    "weekly_off" TEXT NOT NULL DEFAULT '0',

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "school_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "unique_no" TEXT NOT NULL,
    "rfid_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "parent_phone" TEXT NOT NULL,
    "photo_url" TEXT,
    "uses_transport" BOOLEAN NOT NULL DEFAULT false,
    "admission_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "in_time" TIMESTAMP(3),
    "out_time" TIMESTAMP(3),
    "status" TEXT NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "rfid_uid" TEXT NOT NULL,
    "scan_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeStructure" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "tuition_fee" INTEGER NOT NULL DEFAULT 0,
    "transport_fee" INTEGER NOT NULL DEFAULT 0,
    "library_fee" INTEGER NOT NULL DEFAULT 0,
    "total_annual_fee" INTEGER NOT NULL,

    CONSTRAINT "FeeStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePayment" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "amount_paid" INTEGER NOT NULL,
    "pending_amount" INTEGER NOT NULL,
    "payment_mode" TEXT NOT NULL,
    "fee_type" TEXT NOT NULL DEFAULT 'TUITION',
    "fy" INTEGER NOT NULL DEFAULT 0,
    "billing_mode" TEXT NOT NULL DEFAULT 'MONTHLY',
    "months" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "collected_by" TEXT,
    "reprint_count" INTEGER NOT NULL DEFAULT 0,
    "receipt_no" TEXT NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeHead" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transport_only" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeHead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassFee" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "head_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'YEARLY',
    "installments" JSONB,

    CONSTRAINT "ClassFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discount" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "head_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentFee" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "head_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'YEARLY',
    "installments" JSONB,
    "note" TEXT NOT NULL DEFAULT '',
    "set_by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentDiscount" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountEntry" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "fy" INTEGER NOT NULL,
    "head_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "given_by" TEXT NOT NULL,
    "given_by_name" TEXT NOT NULL,
    "payment_id" TEXT,
    "month_idx" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePaymentLine" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "fy" INTEGER NOT NULL,
    "head_id" TEXT NOT NULL,
    "head_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "month_idx" INTEGER,

    CONSTRAINT "FeePaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobQueue" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeMonthMap" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "fy" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "class" TEXT NOT NULL DEFAULT '',
    "student_id" TEXT NOT NULL DEFAULT '',
    "head_id" TEXT NOT NULL,
    "months" JSONB NOT NULL,
    "set_by" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeMonthMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Holiday',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "school_id" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'OFF',
    "run_time" TEXT NOT NULL DEFAULT '02:00',
    "range" TEXT NOT NULL DEFAULT 'ALL',
    "datasets" JSONB,
    "make_excel" BOOLEAN NOT NULL DEFAULT true,
    "make_json" BOOLEAN NOT NULL DEFAULT true,
    "make_bak" BOOLEAN NOT NULL DEFAULT true,
    "to_drive" BOOLEAN NOT NULL DEFAULT false,
    "keep_last" INTEGER NOT NULL DEFAULT 30,
    "last_run_at" TIMESTAMP(3),
    "last_status" TEXT NOT NULL DEFAULT '',
    "last_error" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupFile" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "school_id" TEXT,
    "kind" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "period" TEXT NOT NULL DEFAULT 'MANUAL',
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_by" TEXT NOT NULL DEFAULT '',
    "drive_status" TEXT NOT NULL DEFAULT 'NONE',
    "drive_id" TEXT,
    "drive_error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "School_code_key" ON "School"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_school_id_idx" ON "User"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "Student_unique_no_key" ON "Student"("unique_no");

-- CreateIndex
CREATE UNIQUE INDEX "Student_rfid_uid_key" ON "Student"("rfid_uid");

-- CreateIndex
CREATE INDEX "Student_school_id_class_idx" ON "Student"("school_id", "class");

-- CreateIndex
CREATE INDEX "Student_school_id_unique_no_idx" ON "Student"("school_id", "unique_no");

-- CreateIndex
CREATE INDEX "Student_school_id_parent_phone_idx" ON "Student"("school_id", "parent_phone");

-- CreateIndex
CREATE INDEX "Attendance_school_id_date_idx" ON "Attendance"("school_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_student_id_date_key" ON "Attendance"("student_id", "date");

-- CreateIndex
CREATE INDEX "AttendanceLog_school_id_idx" ON "AttendanceLog"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "FeeStructure_school_id_class_key" ON "FeeStructure"("school_id", "class");

-- CreateIndex
CREATE UNIQUE INDEX "FeePayment_receipt_no_key" ON "FeePayment"("receipt_no");

-- CreateIndex
CREATE INDEX "FeePayment_school_id_student_id_idx" ON "FeePayment"("school_id", "student_id");

-- CreateIndex
CREATE INDEX "FeePayment_school_id_payment_date_idx" ON "FeePayment"("school_id", "payment_date");

-- CreateIndex
CREATE UNIQUE INDEX "FeeHead_school_id_name_key" ON "FeeHead"("school_id", "name");

-- CreateIndex
CREATE INDEX "ClassFee_school_id_class_idx" ON "ClassFee"("school_id", "class");

-- CreateIndex
CREATE UNIQUE INDEX "ClassFee_school_id_class_head_id_key" ON "ClassFee"("school_id", "class", "head_id");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_school_id_name_key" ON "Discount"("school_id", "name");

-- CreateIndex
CREATE INDEX "StudentFee_school_id_idx" ON "StudentFee"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "StudentFee_student_id_head_id_key" ON "StudentFee"("student_id", "head_id");

-- CreateIndex
CREATE INDEX "StudentDiscount_school_id_idx" ON "StudentDiscount"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "StudentDiscount_student_id_discount_id_key" ON "StudentDiscount"("student_id", "discount_id");

-- CreateIndex
CREATE INDEX "DiscountEntry_school_id_student_id_fy_idx" ON "DiscountEntry"("school_id", "student_id", "fy");

-- CreateIndex
CREATE INDEX "DiscountEntry_school_id_fy_idx" ON "DiscountEntry"("school_id", "fy");

-- CreateIndex
CREATE INDEX "FeePaymentLine_school_id_student_id_fy_idx" ON "FeePaymentLine"("school_id", "student_id", "fy");

-- CreateIndex
CREATE INDEX "FeePaymentLine_payment_id_idx" ON "FeePaymentLine"("payment_id");

-- CreateIndex
CREATE INDEX "JobQueue_status_run_at_idx" ON "JobQueue"("status", "run_at");

-- CreateIndex
CREATE INDEX "FeeMonthMap_school_id_fy_idx" ON "FeeMonthMap"("school_id", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "FeeMonthMap_school_id_fy_scope_class_student_id_head_id_key" ON "FeeMonthMap"("school_id", "fy", "scope", "class", "student_id", "head_id");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_school_id_date_key" ON "Holiday"("school_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BackupConfig_scope_key" ON "BackupConfig"("scope");

-- CreateIndex
CREATE INDEX "BackupFile_scope_createdAt_idx" ON "BackupFile"("scope", "createdAt");

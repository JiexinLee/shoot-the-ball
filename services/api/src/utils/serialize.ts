/**
 * BigInt 序列化工具 + 全局 JSON.stringify replacer 补丁
 *
 * 为什么需要：
 *   Prisma 5.x 默认把 Postgres BIGINT 列读成 JS BigInt 类型（避免大于 2^53-1 的整数被 Number 丢精度）。
 *   但 JSON.stringify 原生不支持 BigInt → TypeError: Do not know how to serialize a BigInt。
 *   例如 videos.sizeBytes、jobs.progressBytes、exports.totalBytes 这些列都会触发。
 *
 * 双保险策略：
 *   1) installGlobalBigIntJsonPatch() — 在 main.ts 启动第一行调用，给全局 JSON.stringify 装 replacer，
 *      兜底「任何漏改的接口都不会因为 BigInt 直接 500」；
 *   2) 所有 domain DTO 返回时显式调用 serializeBigInts() — 把 BigInt 列（含嵌套）改成十进制字符串，
 *      保证前后端契约类型 `@shoot-the-ball/contracts` 里 `sizeBytes: string` 永远一致，
 *      不依赖全局 replacer 这种「隐式魔法」，契约语义清晰。
 *
 * 契约约定（contracts 包要同步）：任何存储/长度/字节/计数型的 BIGINT 列，对外都用 `string` 类型，
 * 前端 `parseInt(s, 10)` 或 `BigInt(s)` 按需解析；不要直接用 number，防止 9PB 级视频 size 丢精度。
 */

// ---------------------------------------------------------------------------
// ① 全局 replacer 补丁（兜底保护）
// ---------------------------------------------------------------------------
// JSON.stringify 的 replacer 必须是 (key, value) 双参签名才能拿到每个属性名，
// 这里我们只按值类型（bigint / 其它）决策，不按 key 名分支——所以 key 加 _ 前缀
// 表示「约定故意不读取」，不触发 noUnusedParameters / eslint no-unused-vars。
const bigIntReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
};

export function installGlobalBigIntJsonPatch(): void {
  // 只装一次，防止 pnpm dev 热 reload 重复 monkey patch
  if (
    (JSON.stringify as unknown as { __bigintPatched?: boolean }).__bigintPatched
  ) {
    return;
  }

  const originalStringify = JSON.stringify.bind(JSON);
  const patched = function stringifyWithBigInt(
    this: unknown,
    value: unknown,
    arg2?: unknown,
    arg3?: unknown,
  ): string {
    // 用户自己传了 replacer 函数：把 BigInt 逻辑合成到用户 replacer 后面执行，
    // 避免「用户 replacer 先跑把 BigInt 转字符串又被 BigInt replacer 覆盖」的冲突。
    if (typeof arg2 === "function") {
      const userReplacer = arg2 as (key: string, v: unknown) => unknown;
      const composed: (key: string, v: unknown) => unknown = (k, v) =>
        bigIntReplacer(k, userReplacer.call(this, k, v));
      return originalStringify(
        value,
        composed as (key: string, value: unknown) => unknown,
        arg3 as string | number | undefined,
      );
    }
    // arg2 是数组 replacer / null / space 数字：直接用我们的 BigInt replacer，
    // 剩下的参数按原样交给原生 JSON.stringify 判断（数组 replacer 时 arg3=space）。
    if (Array.isArray(arg2)) {
      return originalStringify(
        value,
        arg2,
        arg3 as string | number | undefined,
      );
    }
    // 没传 replacer：arg2 是 space 或 undefined，我们把 BigInt replacer 放在第二个参数位
    return originalStringify(
      value,
      bigIntReplacer,
      (arg2 ?? undefined) as string | number | undefined,
    );
  };

  (patched as unknown as { __bigintPatched?: boolean }).__bigintPatched = true;
  JSON.stringify = patched;
}

// ---------------------------------------------------------------------------
// ② 显式序列化工具（对外 DTO 必须调用，契约语义清晰）
// ---------------------------------------------------------------------------

/**
 * 把任意（嵌套）对象里的 BigInt 全部换成十进制字符串，返回一个「可被 JSON 序列化、且
 * 类型契约等同于 contracts 包 Zod 定义」的纯 JSON 对象。
 *
 * 对普通类型（string / number / boolean / null / undefined / Date）保持原样 pass-through；
 * 数组 / 普通对象递归；
 * Map/Set/Symbol/函数这些本就不该出现在 HTTP response 里，原样交给 JSON.stringify 处理（或丢弃）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeBigInts<T = any>(input: T): any {
  if (input === null || input === undefined) {
    return input as unknown;
  }

  if (typeof input === "bigint") {
    return input.toString();
  }

  if (typeof input !== "object") {
    // primitives: string / number / boolean / symbol
    return input as unknown;
  }

  if (input instanceof Date) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => serializeBigInts(item));
  }

  // 普通对象：遍历 keys 递归
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input as Record<string, unknown>)) {
    out[key] = serializeBigInts((input as Record<string, unknown>)[key]);
  }
  return out;
}

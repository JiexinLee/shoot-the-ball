import { useEffect, useState } from "react";

export type CustomModelGuideModalProps = {
  open: boolean;
  onClose: () => void;
};

export function CustomModelGuideModal({
  open,
  onClose,
}: CustomModelGuideModalProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMounted(true);
    const t = window.setTimeout(() => setVisible(true), 10);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (mounted) return;
    setVisible(false);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const handleClose = () => {
    setVisible(false);
    const t = window.setTimeout(() => {
      setMounted(false);
      onClose();
    }, 180);
    return () => window.clearTimeout(t);
  };

  if (!mounted) return null;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      className={[
        "fixed inset-0 z-[100] flex items-center justify-center p-4",
        "transition-opacity duration-150 ease-out will-change-opacity",
        visible
          ? "opacity-100 bg-black/70 backdrop-blur-sm pointer-events-auto"
          : "opacity-0 bg-black/0 backdrop-blur-none pointer-events-none",
      ].join(" ")}
      role="dialog"
      aria-modal="true"
      aria-label="How to use a custom trained YOLO model"
    >
      <div
        className={[
          "relative w-[min(92vw,860px)] max-h-[86vh]",
          "rounded-xl border border-border bg-card text-foreground",
          "shadow-2xl flex flex-col overflow-hidden",
          "transition-all duration-150 ease-out will-change-transform will-change-opacity",
          visible
            ? "opacity-100 translate-y-0 scale-100"
            : "opacity-0 translate-y-3 scale-[0.98]",
        ].join(" ")}
      >
        <header className="flex items-start justify-between gap-4 p-5 border-b border-border">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              <h2 className="text-xl font-bold">
                你自己训完 best.pt 之后，怎么在这儿用
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">
              4 步，不用改代码。就是把 EC2 上那个 best.pt 拉到本机，然后粘路径。
            </p>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close guide"
            className="shrink-0 h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div className="p-5 overflow-y-auto space-y-5 text-sm leading-relaxed">
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-base font-bold text-primary">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                1
              </span>
              从 EC2 把 best.pt 拉到你 Mac 本地
            </h3>
            <p className="text-muted-foreground pl-8">
              YOLO 训完后，权重就在 training run 目录下，只拿{" "}
              <code>best.pt</code>（这个是验证集上 mAP 最好的那次）。不要用
              last.pt（最后一次 checkpoint，通常不如 best）。
            </p>
            <pre className="ml-8 rounded-md border border-border bg-black/50 p-3 text-[12px] font-mono text-foreground whitespace-pre-wrap break-words">
              {`# 训练产物长这样：
#
#   ~/shoot-the-ball/services/ai-worker/
#     runs/detect/train12/     ← 你第 12 次训练
#       weights/
#         best.pt   ← 用这个
#         last.pt   ← 不用

# 用 SCP 把 best.pt 从 EC2 拉回本地：
scp -i ~/.ssh/your-ec2-key.pem \\
  ubuntu@<EC2公网IP>:/home/ubuntu/shoot-the-ball/services/ai-worker/runs/detect/train12/weights/best.pt \\
  ~/MyProjects/shoot-the-ball/models/custom-bball-v1.pt`}
            </pre>
            <p className="text-xs text-muted-foreground pl-8">
              省事儿做法：训完直接把 best.pt 丢到 Cloudflare R2，然后从 R2
              控制台点下载也行，不用开 SSH。
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-base font-bold text-primary">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                2
              </span>
              复制 best.pt 的<strong>绝对路径</strong>
            </h3>
            <p className="text-muted-foreground pl-8">
              必须是本地文件路径，R2/S3 那种 URL 直接填是跑不通的（detect.py
              不会自己下载）。
            </p>
            <div className="ml-8 rounded-md border border-border bg-muted/40 p-3 space-y-1 text-xs">
              <p>
                <span className="font-semibold text-foreground">✅ 对的</span>：
                <code className="ml-2 inline-block font-mono bg-black/40 text-primary px-1.5 py-0.5 rounded">
                  /Users/jiexinli/MyProjects/shoot-the-ball/models/custom-bball-v1.pt
                </code>
              </p>
              <p>
                <span className="font-semibold text-foreground">✅ 也行</span>：
                <code className="ml-2 inline-block font-mono bg-black/40 text-primary px-1.5 py-0.5 rounded">
                  ~/models/custom-bball-v1.pt
                </code>
                <span className="text-muted-foreground ml-2">
                  （macOS 自动帮你展开 ~）
                </span>
              </p>
              <p>
                <span className="font-semibold text-destructive">❌ 错的</span>
                ：
                <code className="ml-2 inline-block font-mono bg-black/40 text-destructive px-1.5 py-0.5 rounded">
                  s3://bucket/models/best.pt
                </code>
                <span className="text-muted-foreground ml-2">
                  （不是本地文件，直接报错 FileNotFound）
                </span>
              </p>
            </div>
            <p className="text-xs text-muted-foreground pl-8 pt-1">
              💡 小技巧：Finder 里找到 best.pt → 按住 <code>⌥ Option</code>{" "}
              右键文件 → 菜单里会出现「复制 best.pt
              为路径名」，一键就是绝对路径。
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-base font-bold text-primary">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                3
              </span>
              Detection targets 选 <code>Custom class IDs</code>，填你训练时的
              id
            </h3>
            <p className="text-muted-foreground pl-8">
              这里填的数字<strong>必须和 data.yaml 里你写的一模一样</strong>
              。我们项目约定的是：
            </p>
            <div className="ml-8 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded-md border border-border bg-black/40 p-3">
                <div className="font-mono text-[#22c55e] font-semibold">
                  id=0 → person
                </div>
                <div className="text-muted-foreground mt-0.5">
                  球员、裁判、观众席
                </div>
              </div>
              <div className="rounded-md border border-border bg-black/40 p-3">
                <div className="font-mono text-[#facc15] font-semibold">
                  id=1 → basketball
                </div>
                <div className="text-muted-foreground mt-0.5">
                  篮球（COCO 默认的 32 sports ball 认这个不准，要你自己训）
                </div>
              </div>
              <div className="rounded-md border border-border bg-black/40 p-3">
                <div className="font-mono text-[#3b82f6] font-semibold">
                  id=2 → rim / hoop
                </div>
                <div className="text-muted-foreground mt-0.5">
                  篮筐圈（COCO 根本没这个类，只有自定义模型才出得来框）
                </div>
              </div>
            </div>
            <div className="ml-8 mt-2 rounded-md border border-border bg-muted/40 p-3 text-xs space-y-1">
              <p>
                所以 2. Detection targets 那栏直接选「Custom class IDs (comma
                separated)」，填：
              </p>
              <p className="font-mono bg-black/60 text-primary px-2 py-1 rounded inline-block">
                0,1,2
              </p>
              <p className="text-muted-foreground pt-1">
                想单独调试球就填 <code className="font-mono">1</code>
                ，想看篮筐就填 <code className="font-mono">2</code>。
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-base font-bold text-primary">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                4
              </span>
              5. YOLO model 选 Custom model path…，粘路径，跑
            </h3>
            <ul className="ml-8 list-disc list-outside pl-4 space-y-1 text-muted-foreground">
              <li>
                第一次跑建议先{" "}
                <strong>conf 0.25～0.4 + sample every 5～10 帧</strong>
                ，先看看整体能认出多少。
              </li>
              <li>
                跑起来后先看<strong>左侧的 detect.py stderr log</strong>
                折叠面板，如果报{" "}
                <code className="font-mono text-destructive">FileNotFound</code>{" "}
                就是路径写错了。
              </li>
              <li>
                画面上：person 绿框、basketball 黄框、rim 蓝框 ——
                如果颜色不对但框在，那是你 data.yaml 的 class id
                顺序和我约定的不一样。
              </li>
            </ul>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="flex items-center gap-2 text-base font-bold text-primary">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-destructive text-destructive-foreground text-xs font-bold">
                !
              </span>
              常见坑 & 快速排查
            </h3>
            <ul className="ml-8 list-disc list-outside pl-4 space-y-1 text-muted-foreground">
              <li>
                <strong>跑完全部 0 个检测框</strong>：先把 conf 降到{" "}
                <strong>0.1</strong> 再跑一次；如果还是 0 → 90% 是 Detection
                targets 里的 class IDs 和你模型的输出对不上（或者 best.pt
                本身就没训好，训的时候类别和你现在选的不一致）。
              </li>
              <li>
                <strong>框偏了/框不住人</strong>：看下方「Current-frame bbox
                inspector」，对比 <code>native=(x1,y1)-(x2,y2)</code> 和{" "}
                <code>screen=…</code>。
                <ul className="list-[circle] pl-4 mt-0.5 space-y-0.5 text-[12px]">
                  <li>
                    native 本身就不在人身上 →{" "}
                    <strong>模型/dataset 标注的问题</strong>，跟渲染代码没关系
                  </li>
                  <li>
                    native 对的，screen 偏了 → 我的 bug，直接把那行数字贴给我
                  </li>
                </ul>
              </li>
              <li>
                <strong>视频能播但检测一直 Running 不结束</strong>：多半是
                MPS/CUDA 显存炸了，看 stderr 最后几行。换 yolov8n 小模型或者
                sample every 拉大点。
              </li>
            </ul>
          </section>
        </div>

        <footer className="px-5 py-3 border-t border-border bg-muted/40 flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
          >
            明白了，去跑
          </button>
        </footer>
      </div>
    </div>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function Navigation({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  const items = [
    ["/cards", "共有名刺"],
    ["/scan", "スキャン"],
    ["/drafts", "自分の下書き"],
    ["/settings/trash", "ごみ箱"],
    ...(admin
      ? [
          ["/settings/members", "メンバー"],
          ["/settings/operations", "運用状況"],
        ]
      : []),
  ];
  return (
    <nav className="nav" aria-label="メインメニュー">
      {items.map(([href, label]) => (
        <Link
          key={href}
          href={{ pathname: href }}
          aria-current={
            pathname === href || pathname.startsWith(href + "/")
              ? "page"
              : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

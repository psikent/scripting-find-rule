import {
  Script,
  Navigation,
  NavigationStack,
  NavigationLink,
  List,
  Section,
  Picker,
  TextField,
  Button,
  Text,
  HStack,
  Spacer,
  ProgressView,
  fetch,
} from "scripting"
import { useState, useCallback, useEffect } from "scripting"

// 支持的代理工具列表
const PROXY_TOOLS = [
  "Surge",
  "Clash",
  "Loon",
  "QuantumultX",
  "Shadowrocket",
  "AdGuard",
] as const

type ProxyTool = (typeof PROXY_TOOLS)[number]

// 规则文件扩展名映射
const TOOL_FILE_EXT: Record<ProxyTool, string> = {
  Surge: ".list",
  Clash: ".yaml",
  Loon: ".list",
  QuantumultX: ".conf",
  Shadowrocket: ".list",
  AdGuard: ".txt",
}

// GitHub 仓库信息
const REPO_OWNER = "blackmatrix7"
const REPO_NAME = "ios_rule_script"
const BRANCH = "master"
const BASE_PATH = "rule"

const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}`

// GitHub API 返回的目录项接口
interface GithubContentItem {
  name: string
  path: string
  type: "dir" | "file"
  url: string
  git_url: string | null
  download_url: string | null
}

// 规则搜索结果项
interface RuleResult {
  name: string
  path: string
  displayName: string
}

// Pasteboard 全局声明
declare namespace Pasteboard {
  function setString(value: string): Promise<void>
}

// 获取规则目录下的主文件信息
async function findMainFile(rule: RuleResult, tool: ProxyTool): Promise<{ fileName: string; downloadUrl: string; rawUrl: string } | null> {
  const ext = TOOL_FILE_EXT[tool]
  const url = `${API_BASE}/contents/${rule.path}`
  const response = await fetch(url, {
    headers: { "Accept": "application/vnd.github.v3+json" },
  })
  if (!response.ok) {
    throw new Error(`获取文件列表失败: ${response.status}`)
  }
  const files: GithubContentItem[] = await response.json()

  const mainFile = files.find(f =>
    f.type === "file" &&
    (f.name === `${rule.name}${ext}` || f.name.endsWith(ext))
  ) || files.find(f => f.type === "file" && f.name.endsWith(ext))

  if (!mainFile) return null

  return {
    fileName: mainFile.name,
    downloadUrl: mainFile.download_url!,
    rawUrl: `${RAW_BASE}/${rule.path}/${mainFile.name}`,
  }
}

// ========== 主页面 ==========

function MainPage() {
  const [selectedTool, setSelectedTool] = useState<ProxyTool>("Surge")
  const [searchText, setSearchText] = useState("")
  const [allRules, setAllRules] = useState<RuleResult[]>([])
  const [loadingRules, setLoadingRules] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRules = useCallback(async (tool: ProxyTool) => {
    setLoadingRules(true)
    setError(null)
    try {
      const url = `${API_BASE}/contents/${BASE_PATH}/${tool}`
      const response = await fetch(url, {
        headers: { "Accept": "application/vnd.github.v3+json" },
      })
      if (!response.ok) {
        throw new Error(`GitHub API 请求失败: ${response.status}`)
      }
      const items: GithubContentItem[] = await response.json()
      const rules: RuleResult[] = items
        .filter(item => item.type === "dir")
        .map(item => ({
          name: item.name,
          path: item.path,
          displayName: item.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setAllRules(rules)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载规则列表失败")
      setAllRules([])
    } finally {
      setLoadingRules(false)
    }
  }, [])

  useEffect(() => {
    fetchRules(selectedTool)
  }, [selectedTool, fetchRules])

  const filteredResults = searchText.trim() === ""
    ? allRules
    : allRules.filter(r =>
        r.name.toLowerCase().includes(searchText.toLowerCase()) ||
        r.displayName.toLowerCase().includes(searchText.toLowerCase())
      )

  return (
    <NavigationStack>
      <List
        navigationTitle="规则搜索"
        navigationBarTitleDisplayMode="inline"
      >
        <Section title="代理工具">
          <Picker
            title="选择代理工具"
            value={selectedTool}
            onChanged={(value: string) => setSelectedTool(value as ProxyTool)}
          >
            {PROXY_TOOLS.map(tool => (
              <Text key={tool} tag={tool}>{tool}</Text>
            ))}
          </Picker>
        </Section>

        <Section title="搜索规则">
          <TextField
            title="关键词"
            value={searchText}
            onChanged={setSearchText}
            prompt="输入关键词搜索规则..."
            autofocus={false}
          />
        </Section>

        {loadingRules ? (
          <Section>
            <HStack padding={8}>
              <ProgressView />
              <Text>  加载规则列表中...</Text>
            </HStack>
          </Section>
        ) : error ? (
          <Section>
            <Text>加载失败: {error}</Text>
          </Section>
        ) : (
          <Section title={`搜索结果 (${filteredResults.length})`}>
            {filteredResults.length === 0 ? (
              <Text>{(searchText.trim() !== "" ? "未找到匹配的规则" : "请选择代理工具搜索规则")}</Text>
            ) : (
              filteredResults.map(rule => (
                <NavigationLink
                  key={rule.path}
                  title={rule.displayName}
                  destination={
                    <RuleDetailPage
                      rule={rule}
                      tool={selectedTool}
                    />
                  }
                />
              ))
            )}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

// ========== 规则详情页 ==========

function RuleDetailPage({
  rule,
  tool,
}: {
  rule: RuleResult
  tool: ProxyTool
}) {
  const dismiss = Navigation.useDismiss()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mainFile, setMainFile] = useState<{ fileName: string; downloadUrl: string; rawUrl: string } | null>(null)
  const [fileLoading, setFileLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setFileLoading(true)
      try {
        const info = await findMainFile(rule, tool)
        setMainFile(info)
      } catch {
        // ignore
      } finally {
        setFileLoading(false)
      }
    })()
  }, [rule, tool])

  const handlePreview = () => {
    (async () => {
      if (!mainFile) return
      setLoading(true)
      try {
        const contentResp = await fetch(mainFile.downloadUrl)
        if (!contentResp.ok) {
          throw new Error(`获取文件内容失败: ${contentResp.status}`)
        }
        const content = await contentResp.text()

        const lines = content.split("\n")
        const previewLines = lines.slice(0, 200)
        const truncated = lines.length > 200
        const previewText = previewLines.join("\n") + (truncated ? "\n\n... (仅显示前 200 行，共 " + lines.length + " 行)" : "")

        await Navigation.present(
          <PreviewPage
            ruleName={rule.displayName}
            fileName={mainFile.fileName}
            content={previewText}
            totalLines={lines.length}
          />
        )
      } catch (e) {
        // 预览失败时不做特殊处理
      } finally {
        setLoading(false)
      }
    })()
  }

  const handleCopyPath = () => {
    (async () => {
      if (!mainFile) return
      try {
        await Pasteboard.setString(mainFile.rawUrl)
        setCopied(true)
        // 2 秒后自动隐藏提示
        setTimeout(() => setCopied(false), 2000)
      } catch (e) {
        // 拷贝失败
      }
    })()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={rule.displayName}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="返回" action={dismiss} />
        }}
      >
        <Section title="规则信息">
          <HStack>
            <Text>名称</Text>
            <Spacer />
            <Text>{rule.displayName}</Text>
          </HStack>
          <HStack>
            <Text>路径</Text>
            <Spacer />
            <Text font={12}>{rule.path}</Text>
          </HStack>
          {fileLoading ? (
            <HStack padding={8}>
              <ProgressView />
              <Text>  查找规则文件中...</Text>
            </HStack>
          ) : mainFile ? (
            <HStack>
              <Text>文件</Text>
              <Spacer />
              <Text font={12}>{mainFile.fileName}</Text>
            </HStack>
          ) : (
            <Text>未找到规则文件</Text>
          )}
        </Section>

        <Section title="操作">
          <Button
            title="📄 预览规则内容"
            action={handlePreview}
            disabled={loading || !mainFile}
          />
          <Button
            title="🔗 拷贝 Raw 链接"
            action={handleCopyPath}
            disabled={!mainFile}
          />
        </Section>

        {copied && (
          <Section>
            <HStack padding={8}>
              <Text>✅ 已拷贝到剪贴板</Text>
              <Spacer />
              <Text font={12}>{mainFile!.fileName}</Text>
            </HStack>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

// ========== 预览页 ==========

function PreviewPage({
  ruleName,
  fileName,
  content,
  totalLines,
}: {
  ruleName: string
  fileName: string
  content: string
  totalLines: number
}) {
  const dismiss = Navigation.useDismiss()

  return (
    <NavigationStack>
      <List
        navigationTitle={ruleName}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />
        }}
      >
        <Section title={`文件: ${fileName} (共 ${totalLines} 行)`}>
          <Text font={12}>{content}</Text>
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<MainPage />)
  Script.exit()
}

run()

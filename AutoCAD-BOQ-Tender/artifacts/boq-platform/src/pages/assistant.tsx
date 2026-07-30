import { useState, useRef, useEffect } from "react";
import { 
  useListOpenaiConversations,
  getListOpenaiConversationsQueryKey,
  useCreateOpenaiConversation,
  useGetOpenaiConversation,
  getGetOpenaiConversationQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Plus, Bot, User, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ModelSelector } from "@/components/model-selector";
import { useModelPreference } from "@/hooks/use-model-preference";

export function Assistant() {
  const searchParams = new URLSearchParams(window.location.search);
  const projectIdParam = searchParams.get("projectId");
  const defaultProjectId = projectIdParam ? Number(projectIdParam) : undefined;

  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { pref, providerConfig } = useModelPreference();
  const queryClient = useQueryClient();
  const createConv = useCreateOpenaiConversation();

  const { data: conversations, isLoading: isLoadingConvs } = useListOpenaiConversations({
    query: { queryKey: getListOpenaiConversationsQueryKey() }
  });

  const { data: activeConv, isLoading: isLoadingMsgs } = useGetOpenaiConversation(
    activeConversationId!, 
    { query: { enabled: !!activeConversationId, queryKey: getGetOpenaiConversationQueryKey(activeConversationId!) } }
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeConv?.messages, streamingContent]);

  useEffect(() => {
    if (!isLoadingConvs && conversations) {
      if (conversations.length > 0 && !activeConversationId) {
        setActiveConversationId(conversations[0].id);
      } else if (conversations.length === 0 && !activeConversationId) {
        handleNewConversation();
      }
    }
  }, [conversations, isLoadingConvs, activeConversationId]);

  const handleNewConversation = () => {
    createConv.mutate({
      data: { title: "New Chat", projectId: defaultProjectId }
    }, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
        setActiveConversationId(data.id);
      }
    });
  };

  const handleSend = async () => {
    if (!input.trim() || !activeConversationId || isStreaming) return;
    
    const userMessage = input;
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");

    queryClient.setQueryData(
      getGetOpenaiConversationQueryKey(activeConversationId),
      (old: any) => old ? {
        ...old,
        messages: [...old.messages, { role: "user", content: userMessage, id: Date.now() }]
      } : old
    );

    try {
      const res = await fetch(`/api/openai/conversations/${activeConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: userMessage,
          provider: pref.provider,
          model: pref.model,
          providerConfig,
        })
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullAssistantMessage = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(Boolean);
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullAssistantMessage += data.content;
                setStreamingContent(fullAssistantMessage);
              } else if (data.done) {
                setIsStreaming(false);
                setStreamingContent("");
                queryClient.invalidateQueries({ queryKey: getGetOpenaiConversationQueryKey(activeConversationId) });
              } else if (data.error) {
                setIsStreaming(false);
                setStreamingContent(`Error: ${data.error}`);
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      console.error(e);
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  return (
    <div className="flex h-screen w-full">
      {/* Conversations sidebar */}
      <div className="w-64 border-r bg-muted/30 flex flex-col h-full">
        <div className="p-4 border-b">
          <Button onClick={handleNewConversation} className="w-full justify-start" variant="outline">
            <Plus className="mr-2 h-4 w-4" />
            New Chat
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {isLoadingConvs ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
            ) : conversations?.map(conv => (
              <button
                key={conv.id}
                onClick={() => setActiveConversationId(conv.id)}
                className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                  activeConversationId === conv.id 
                    ? "bg-primary text-primary-foreground font-medium" 
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <div className="truncate">{conv.title}</div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col h-full bg-background">
        <div className="border-b p-4 flex items-center justify-between shadow-sm">
          <h2 className="font-semibold flex items-center gap-2">
            <Bot className="h-5 w-5 text-accent" />
            BOQ Intelligence Assistant
          </h2>
          <ModelSelector />
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8" ref={scrollRef}>
          {isLoadingMsgs && activeConversationId ? (
            <div className="flex justify-center items-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !activeConv?.messages || activeConv.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground max-w-md mx-auto text-center">
              <Bot className="h-16 w-16 mb-4 text-accent/50" />
              <h3 className="text-xl font-medium text-foreground mb-2">How can I help with your project?</h3>
              <p>Ask me to analyze specifications, compare BOQ items, or summarize tender requirements.</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto w-full pb-8">
              {activeConv.messages.map((msg: any) => (
                <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Bot className="h-5 w-5 text-primary" />
                    </div>
                  )}
                  <div className={`px-4 py-3 rounded-lg max-w-[80%] ${
                    msg.role === 'user' 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-muted/50 border shadow-sm text-foreground'
                  }`}>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
                  </div>
                  {msg.role === 'user' && (
                    <div className="h-8 w-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                      <User className="h-5 w-5 text-accent" />
                    </div>
                  )}
                </div>
              ))}
              
              {isStreaming && (
                <div className="flex gap-4 justify-start">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-5 w-5 text-primary" />
                  </div>
                  <div className="px-4 py-3 rounded-lg max-w-[80%] bg-muted/50 border shadow-sm text-foreground">
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{streamingContent}</div>
                    {!streamingContent && <Loader2 className="h-4 w-4 animate-spin mt-1" />}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-background">
          <div className="max-w-4xl mx-auto w-full relative">
            <Input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about project specifications or quantities..."
              className="pr-12 py-6 rounded-xl shadow-sm border-muted-foreground/20 focus-visible:ring-accent"
              disabled={isStreaming || !activeConversationId}
            />
            <Button 
              size="icon" 
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 bg-accent hover:bg-accent/90 text-accent-foreground rounded-lg"
              onClick={handleSend}
              disabled={!input.trim() || isStreaming || !activeConversationId}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

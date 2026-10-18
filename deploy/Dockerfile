FROM node:24.22.0-bookworm-slim
WORKDIR /app
COPY server ./server
COPY web ./web
RUN mkdir /data && chown node:node /data
USER node
ENV FFVI_DATA=/data FFVI_STATIC=/app/web FFVI_BIND=0.0.0.0 PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/api/session').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/cli.mjs"]

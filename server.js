const express=require('express');
const http=require('http');
const path=require('path');
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
const mongoose=require('mongoose');
const cloudinary=require('cloudinary').v2;
const multer=require('multer');
const {Server}=require('socket.io');

const app=express(),server=http.createServer(app),io=new Server(server,{maxHttpBufferSize:2*1024*1024});
const PORT=process.env.PORT||3000;
app.use(express.json({limit:'128kb'}));
app.use(express.static(path.join(__dirname,'public')));
mongoose.connect(process.env.MONGODB_URI).then(()=>console.log('MongoDB connected')).catch(e=>console.error(e));

const userSchema=new mongoose.Schema({
 username:{type:String,required:true,unique:true,trim:true},displayName:String,passwordHash:String,
 tokens:{type:[String],default:[]},avatarUrl:{type:String,default:''},
 settings:{theme:{type:String,default:'dark'},compactMode:{type:Boolean,default:false},sounds:{type:Boolean,default:true},desktopNotifications:{type:Boolean,default:false}}
},{timestamps:true});
const memberSchema=new mongoose.Schema({username:String,nickname:{type:String,default:''},role:{type:String,default:'member'}},{_id:false});
const groupSchema=new mongoose.Schema({name:String,createdBy:String,members:{type:[memberSchema],default:[]},leftMembers:{type:[String],default:[]},pinnedMessageIds:{type:[mongoose.Schema.Types.ObjectId],default:[]}},{timestamps:true});
const attachmentSchema=new mongoose.Schema({url:String,type:{type:String,enum:['image','video','audio']},name:String,size:Number,duration:Number},{_id:false});
const messageSchema=new mongoose.Schema({groupId:{type:mongoose.Schema.Types.ObjectId,ref:'Group',index:true},name:String,displayName:String,avatarUrl:String,text:String,attachment:attachmentSchema,isMemory:{type:Boolean,default:false}},{timestamps:true});
const eventSchema=new mongoose.Schema({groupId:{type:mongoose.Schema.Types.ObjectId,ref:'Group'},title:String,type:{type:String,default:'game'},game:{type:String,default:'Liên Quân Mobile'},startAt:Date,location:String,note:String,createdBy:String,participants:{type:[String],default:[]}},{timestamps:true});
const User=mongoose.model('User',userSchema),Group=mongoose.model('Group',groupSchema),Message=mongoose.model('Message',messageSchema),Event=mongoose.model('Event',eventSchema);

mongoose.connection.once('open',async()=>{if(await Group.countDocuments()===0)await Group.create({name:'Nhóm chung',createdBy:'system',members:[]});});

cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET,secure:true});
const allowed=new Set(['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm','video/quicktime','audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav']);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024},fileFilter:(_r,f,cb)=>allowed.has(f.mimetype)?cb(null,true):cb(new Error('Định dạng file chưa được hỗ trợ.'))});
const token=()=>crypto.randomBytes(24).toString('hex');
const auth=async(req,res,next)=>{try{const t=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const u=await User.findOne({tokens:t});if(!u)return res.status(401).json({error:'Phiên đăng nhập đã hết hạn.'});req.user=u;req.authToken=t;next();}catch{res.status(500).json({error:'Lỗi máy chủ.'});}};
const pub=u=>({username:u.username,displayName:u.displayName||u.username,avatarUrl:u.avatarUrl||'',settings:u.settings||{}});
const owner=(g,u)=>g.createdBy===u||g.members.some(m=>m.username===u&&m.role==='owner');
const accessible=(g,u)=>!g.leftMembers.includes(u);
async function member(g,u){if(!g.members.some(m=>m.username===u)){g.members.push({username:u,role:g.createdBy===u?'owner':'member'});g.leftMembers=g.leftMembers.filter(x=>x!==u);await g.save();}}
function cloudUpload(file){return new Promise((resolve,reject)=>{const s=cloudinary.uploader.upload_stream({folder:'webchat-media',resource_type:'auto'},(e,r)=>e?reject(e):resolve(r));s.end(file.buffer);});}

app.get('/health',(_r,res)=>res.json({ok:true}));
app.post('/api/register',async(req,res)=>{try{const username=String(req.body.username||'').trim().slice(0,24),password=String(req.body.password||'');if(username.length<2||password.length<6)return res.status(400).json({error:'Tên tối thiểu 2 ký tự, mật khẩu tối thiểu 6 ký tự.'});if(await User.findOne({username}))return res.status(400).json({error:'Tên tài khoản đã tồn tại.'});const t=token();await User.create({username,displayName:username,passwordHash:await bcrypt.hash(password,10),tokens:[t]});res.json({token:t,username});}catch(e){res.status(500).json({error:'Không đăng ký được.'});}});
app.post('/api/login',async(req,res)=>{const u=await User.findOne({username:String(req.body.username||'').trim()});if(!u||!await bcrypt.compare(String(req.body.password||''),u.passwordHash))return res.status(400).json({error:'Sai tên hoặc mật khẩu.'});const t=token();u.tokens=[...new Set([...(u.tokens||[]),t])].slice(-8);await u.save();res.json({token:t,username:u.username});});
app.post('/api/logout',auth,async(req,res)=>{req.user.tokens=req.user.tokens.filter(x=>x!==req.authToken);await req.user.save();res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json(pub(req.user)));
app.patch('/api/me/profile',auth,async(req,res)=>{if(req.body.displayName)req.user.displayName=String(req.body.displayName).trim().slice(0,32);if('avatarUrl'in req.body)req.user.avatarUrl=String(req.body.avatarUrl||'').slice(0,1000);if(req.body.settings)req.user.settings={...req.user.settings.toObject?.(),...req.body.settings};await req.user.save();io.emit('profileChanged',pub(req.user));res.json(pub(req.user));});

app.post('/upload',auth,(req,res)=>upload.single('file')(req,res,async e=>{if(e)return res.status(400).json({error:e.message});if(!req.file)return res.status(400).json({error:'Không có file.'});try{const r=await cloudUpload(req.file),m=req.file.mimetype;const type=m.startsWith('audio/')?'audio':m.startsWith('video/')?'video':'image';res.json({url:r.secure_url,type,name:req.file.originalname,size:req.file.size,duration:Number(req.body.duration||0)});}catch(err){res.status(502).json({error:'Cloudinary không nhận được file.'});}}));

app.get('/api/groups',auth,async(req,res)=>{const gs=await Group.find({leftMembers:{$ne:req.user.username}}).sort({updatedAt:-1});res.json(gs.map(g=>({_id:g._id,name:g.name,createdBy:g.createdBy,memberCount:g.members.length,isOwner:owner(g,req.user.username)})));});
app.post('/api/groups',auth,async(req,res)=>{const name=String(req.body.name||'').trim().slice(0,40);if(!name)return res.status(400).json({error:'Nhập tên nhóm.'});const g=await Group.create({name,createdBy:req.user.username,members:[{username:req.user.username,role:'owner'}]});io.emit('groupsChanged');res.json(g);});
app.get('/api/groups/:id',auth,async(req,res)=>{const g=await Group.findById(req.params.id);if(!g||!accessible(g,req.user.username))return res.status(404).json({error:'Không tìm thấy nhóm.'});await member(g,req.user.username);const users=await User.find({username:{$in:g.members.map(m=>m.username)}});const map=new Map(users.map(u=>[u.username,u]));const pins=await Message.find({_id:{$in:g.pinnedMessageIds}});res.json({group:{_id:g._id,name:g.name,isOwner:owner(g,req.user.username)},members:g.members.map(m=>({...m.toObject(),displayName:map.get(m.username)?.displayName||m.username,avatarUrl:map.get(m.username)?.avatarUrl||''})),pinnedMessages:pins});});
app.patch('/api/groups/:id',auth,async(req,res)=>{const g=await Group.findById(req.params.id);if(!g||!owner(g,req.user.username))return res.status(403).json({error:'Chỉ chủ nhóm được sửa.'});if(req.body.name)g.name=String(req.body.name).trim().slice(0,40);await g.save();io.emit('groupsChanged');res.json(g);});
app.delete('/api/groups/:id',auth,async(req,res)=>{const g=await Group.findById(req.params.id);if(!g||!owner(g,req.user.username))return res.status(403).json({error:'Chỉ chủ nhóm được xóa.'});if(g.createdBy==='system')return res.status(400).json({error:'Không thể xóa Nhóm chung.'});await Promise.all([Message.deleteMany({groupId:g._id}),Event.deleteMany({groupId:g._id}),g.deleteOne()]);io.emit('groupDeleted',String(g._id));io.emit('groupsChanged');res.json({ok:true});});
app.post('/api/groups/:id/leave',auth,async(req,res)=>{const g=await Group.findById(req.params.id);if(owner(g,req.user.username))return res.status(400).json({error:'Chủ nhóm không thể rời.'});g.members=g.members.filter(m=>m.username!==req.user.username);g.leftMembers=[...new Set([...g.leftMembers,req.user.username])];await g.save();io.emit('groupsChanged');res.json({ok:true});});
app.post('/api/groups/:id/members',auth,async(req,res)=>{const g=await Group.findById(req.params.id);if(!owner(g,req.user.username))return res.status(403).json({error:'Chỉ chủ nhóm được thêm người.'});const u=await User.findOne({username:String(req.body.username||'').trim()});if(!u)return res.status(404).json({error:'Không tìm thấy tài khoản.'});if(!g.members.some(m=>m.username===u.username))g.members.push({username:u.username});g.leftMembers=g.leftMembers.filter(x=>x!==u.username);await g.save();io.emit('groupsChanged');res.json({ok:true});});
app.patch('/api/groups/:id/nickname',auth,async(req,res)=>{const g=await Group.findById(req.params.id);const target=String(req.body.username||req.user.username);if(target!==req.user.username&&!owner(g,req.user.username))return res.status(403).json({error:'Không có quyền.'});const m=g.members.find(x=>x.username===target);if(!m)return res.status(404).json({error:'Không tìm thấy thành viên.'});m.nickname=String(req.body.nickname||'').slice(0,32);await g.save();io.to(`group:${g._id}`).emit('groupMembersChanged');res.json({ok:true});});
app.get('/api/groups/:id/media',auth,async(req,res)=>res.json(await Message.find({groupId:req.params.id,'attachment.url':{$exists:true},...(req.query.memory==='1'?{isMemory:true}:{})}).sort({createdAt:-1}).limit(250)));
app.patch('/api/groups/:id/pins/:mid',auth,async(req,res)=>{const g=await Group.findById(req.params.id),id=String(req.params.mid),yes=g.pinnedMessageIds.some(x=>String(x)===id);g.pinnedMessageIds=yes?g.pinnedMessageIds.filter(x=>String(x)!==id):[...g.pinnedMessageIds,req.params.mid];await g.save();io.to(`group:${g._id}`).emit('pinsChanged');res.json({pinned:!yes});});
app.patch('/api/messages/:id/memory',auth,async(req,res)=>{const m=await Message.findById(req.params.id);m.isMemory=!m.isMemory;await m.save();res.json({isMemory:m.isMemory});});
app.delete('/api/messages/:id',auth,async(req,res)=>{const m=await Message.findById(req.params.id),g=await Group.findById(m.groupId);if(m.name!==req.user.username&&!owner(g,req.user.username))return res.status(403).json({error:'Không có quyền.'});await m.deleteOne();io.to(`group:${g._id}`).emit('messageDeleted',String(m._id));res.json({ok:true});});

app.get('/api/groups/:id/events',auth,async(req,res)=>res.json(await Event.find({groupId:req.params.id}).sort({startAt:1})));
app.post('/api/groups/:id/events',auth,async(req,res)=>{const e=await Event.create({groupId:req.params.id,title:String(req.body.title||'Kèo Liên Quân').slice(0,80),type:req.body.type||'game',game:req.body.game||'Liên Quân Mobile',startAt:new Date(req.body.startAt),location:String(req.body.location||''),note:String(req.body.note||''),createdBy:req.user.username,participants:[req.user.username]});io.to(`group:${req.params.id}`).emit('eventsChanged');res.json(e);});
app.patch('/api/events/:id/rsvp',auth,async(req,res)=>{const e=await Event.findById(req.params.id),yes=e.participants.includes(req.user.username);e.participants=yes?e.participants.filter(x=>x!==req.user.username):[...e.participants,req.user.username];await e.save();io.to(`group:${e.groupId}`).emit('eventsChanged');res.json({joined:!yes});});
app.delete('/api/events/:id',auth,async(req,res)=>{const e=await Event.findById(req.params.id);await e.deleteOne();io.to(`group:${e.groupId}`).emit('eventsChanged');res.json({ok:true});});

const online=new Map();
async function presence(){const names=[...new Set(online.values())],users=await User.find({username:{$in:names}});io.emit('presence',{users:users.map(pub)});}
io.on('connection',socket=>{
 socket.on('auth',async t=>{const u=await User.findOne({tokens:String(t||'')});if(!u)return socket.emit('authError','Phiên đăng nhập không hợp lệ.');socket.data.user=u.username;online.set(socket.id,u.username);presence();});
 socket.on('joinGroup',async id=>{if(!socket.data.user)return;const g=await Group.findById(id);if(!g||!accessible(g,socket.data.user))return;await member(g,socket.data.user);if(socket.data.group)socket.leave(`group:${socket.data.group}`);socket.data.group=String(id);socket.join(`group:${id}`);const ms=await Message.find({groupId:id}).sort({createdAt:-1}).limit(200);socket.emit('groupHistory',{groupId:String(id),messages:ms.reverse()});});
 socket.on('chatMessage',async(msg={},ack)=>{try{if(!socket.data.user||!socket.data.group)return ack?.({ok:false,error:'Chưa vào nhóm.'});const u=await User.findOne({username:socket.data.user}),text=String(msg.text||'').trim().slice(0,2000),a=msg.attachment&&['image','video','audio'].includes(msg.attachment.type)?msg.attachment:null;if(!text&&!a)return ack?.({ok:false,error:'Tin nhắn trống.'});const m=await Message.create({groupId:socket.data.group,name:u.username,displayName:u.displayName||u.username,avatarUrl:u.avatarUrl||'',text,attachment:a});io.to(`group:${socket.data.group}`).emit('message',m);ack?.({ok:true});}catch(e){ack?.({ok:false,error:'Không gửi được.'});}});
 socket.on('typing',x=>socket.data.group&&socket.to(`group:${socket.data.group}`).emit('typing',{name:socket.data.user,isTyping:!!x}));
 socket.on('disconnect',()=>{online.delete(socket.id);presence();});
});
server.listen(PORT,()=>console.log(`Server on ${PORT}`));